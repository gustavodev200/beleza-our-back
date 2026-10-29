import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  Prisma,
  type AppointmentOrigin,
  type AppointmentStatus,
  type Business,
} from '@prisma/client';
import { PHONE_EMAIL_DOMAIN } from '../auth/better-auth';
import type { AuthUser } from '../auth/decorators';
import {
  AvailabilityService,
  OWNER_WINDOW_DAYS,
  type DayContext,
} from '../availability/availability.service';
import { Errors, isOverlapViolation } from '../common/errors';
import { paginationSchema, skipTake, toPage, type Pagination } from '../common/utils/pagination';
import { dayBounds, localDateOf } from '../common/utils/time';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import {
  planOwnerTransition,
  withinClientWindow,
  type OwnerAction,
} from './appointment-transitions';
import type {
  CounterAppointmentDto,
  CreateAppointmentDto,
  RescheduleDto,
} from './appointment.schemas';

const appointmentView = {
  id: true,
  status: true,
  origin: true,
  startsAt: true,
  endsAt: true,
  priceCents: true,
  durationMinutes: true,
  serviceName: true,
  notes: true,
  cancelledBy: true,
  createdAt: true,
  serviceId: true,
  professional: { select: { id: true, name: true } },
  business: {
    select: {
      id: true,
      name: true,
      slug: true,
      address: true,
      neighborhood: true,
      latitude: true,
      longitude: true,
      whatsapp: true,
    },
  },
  review: { select: { id: true, rating: true } },
} satisfies Prisma.AppointmentSelect;

export const ownerAppointmentView = {
  id: true,
  status: true,
  origin: true,
  startsAt: true,
  endsAt: true,
  priceCents: true,
  durationMinutes: true,
  serviceName: true,
  notes: true,
  cancelledBy: true,
  isNewForOwner: true,
  createdAt: true,
  serviceId: true,
  professional: { select: { id: true, name: true } },
  client: { select: { id: true, name: true, phoneNumber: true } },
} satisfies Prisma.AppointmentSelect;

interface BookingRequest {
  business: Pick<Business, 'id' | 'status' | 'requiresConfirmation'>;
  serviceId: string;
  professionalId?: string | null;
  startsAt: Date;
  clientId: string;
  notes?: string;
  origin: AppointmentOrigin;
  windowDays?: number;
}

/** Marca como "não necessário" lembretes cujo momento já passou na criação. */
function reminderFlags(startsAt: Date, now = new Date()) {
  const ms = startsAt.getTime() - now.getTime();
  return {
    reminder24hSentAt: ms < 24 * 3_600_000 ? now : null,
    reminder2hSentAt: ms < 2 * 3_600_000 ? now : null,
  };
}

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly availability: AvailabilityService,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
  ) {}

  // ---------------------------------------------------------------- reserva --

  /** Reserva pelo app (US1). Telefone verificado é obrigatório (FR-025). */
  async createFromApp(user: AuthUser, dto: CreateAppointmentDto) {
    if (!user.phoneNumberVerified) throw Errors.phoneNotVerified();
    const business = await this.prisma.business.findFirst({
      where: { id: dto.businessId, status: 'ACTIVE', city: { active: true } },
      select: { id: true, status: true, requiresConfirmation: true },
    });
    if (!business) throw Errors.notFound('Estabelecimento');

    await this.prisma.user.update({
      where: { id: user.id },
      data: { name: dto.clientName, whatsappConsentAt: new Date() },
    });

    const id = await this.book({
      business,
      serviceId: dto.serviceId,
      professionalId: dto.professionalId,
      startsAt: dto.startsAt,
      clientId: user.id,
      notes: dto.notes,
      origin: 'APP',
    });
    await this.notifications.appointmentCreated(id);
    return this.prisma.appointment.findUniqueOrThrow({ where: { id }, select: appointmentView });
  }

  /** Balcão (FR-029): sem código; cliente reaproveitada pelo telefone. */
  async createFromCounter(business: Business, dto: CounterAppointmentDto) {
    const clientId = await this.findOrCreateCounterClient(dto.clientName, dto.clientPhone);
    const id = await this.book({
      business: { ...business, requiresConfirmation: false },
      serviceId: dto.serviceId,
      professionalId: dto.professionalId,
      startsAt: dto.startsAt,
      clientId,
      notes: dto.notes,
      origin: 'COUNTER',
      windowDays: OWNER_WINDOW_DAYS,
    });
    await this.notifications.appointmentCreated(id);
    return this.prisma.appointment.findUniqueOrThrow({
      where: { id },
      select: ownerAppointmentView,
    });
  }

  /**
   * Núcleo da reserva (Princípio IX): trava as profissionais candidatas,
   * recalcula a disponibilidade com a mesma regra da listagem e grava. A
   * exclusion constraint é a garantia final contra corrida.
   */
  private async book(req: BookingRequest): Promise<string> {
    const date = localDateOf(req.startsAt);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const ctx = await this.availability.loadDay(
          {
            businessId: req.business.id,
            serviceId: req.serviceId,
            date,
            professionalId: req.professionalId ?? undefined,
            windowDays: req.windowDays,
          },
          tx,
        );
        await this.lockProfessionals(tx, ctx);
        // Recarrega depois da trava: agora enxerga o que foi commitado enquanto esperava.
        const fresh = await this.availability.loadDay(
          {
            businessId: req.business.id,
            serviceId: req.serviceId,
            date,
            professionalId: req.professionalId ?? undefined,
            windowDays: req.windowDays,
          },
          tx,
        );
        const free = this.availability.freeAt(fresh, req.startsAt);
        const professionalId = await this.pickProfessional(tx, free, date);
        const status: AppointmentStatus =
          req.origin === 'APP' && req.business.requiresConfirmation ? 'PENDING' : 'CONFIRMED';

        const created = await tx.appointment.create({
          data: {
            businessId: req.business.id,
            clientId: req.clientId,
            professionalId,
            serviceId: fresh.service.id,
            startsAt: req.startsAt,
            endsAt: new Date(req.startsAt.getTime() + fresh.service.durationMinutes * 60_000),
            priceCents: fresh.service.priceCents,
            durationMinutes: fresh.service.durationMinutes,
            serviceName: fresh.service.name,
            status,
            origin: req.origin,
            notes: req.notes,
            isNewForOwner: req.origin === 'APP',
            ...reminderFlags(req.startsAt),
          },
          select: { id: true },
        });
        return created.id;
      });
    } catch (e) {
      if (isOverlapViolation(e)) throw Errors.slotTaken();
      throw e;
    }
  }

  private async lockProfessionals(tx: Prisma.TransactionClient, ctx: DayContext): Promise<void> {
    const ids = ctx.input.professionals.map((p) => p.id);
    if (!ids.length) throw Errors.slotUnavailable();
    // Ordem fixa por id evita deadlock entre reservas concorrentes.
    await tx.$queryRaw`SELECT id FROM professionals WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`;
  }

  /** "Sem preferência": a com menos agendamentos ativos no dia; empate por id (FR-024). */
  private async pickProfessional(
    tx: Prisma.TransactionClient,
    free: string[],
    date: string,
  ): Promise<string> {
    if (free.length === 1) return free[0];
    const { start, end } = dayBounds(date);
    const counts = await tx.appointment.groupBy({
      by: ['professionalId'],
      where: {
        professionalId: { in: free },
        status: { in: ['PENDING', 'CONFIRMED'] },
        startsAt: { gte: start, lt: end },
      },
      _count: { _all: true },
    });
    const load = new Map(counts.map((c) => [c.professionalId, c._count._all]));
    return [...free].sort(
      (a, b) => (load.get(a) ?? 0) - (load.get(b) ?? 0) || a.localeCompare(b),
    )[0];
  }

  private async findOrCreateCounterClient(name: string, phone: string): Promise<string> {
    const existing = await this.prisma.user.findUnique({
      where: { phoneNumber: phone },
      select: { id: true, role: true, banned: true },
    });
    if (existing) {
      if (existing.role !== 'CLIENT')
        throw Errors.conflict('PHONE_IN_USE', 'Telefone pertence a outra conta');
      if (existing.banned)
        throw Errors.forbidden('ACCOUNT_BLOCKED', 'Cliente bloqueada na plataforma');
      return existing.id;
    }
    // Mesmo formato do plugin de telefone: quando ela entrar pelo código, a conta é a mesma.
    const user = await this.prisma.user.create({
      data: {
        id: randomUUID(),
        name,
        email: `${phone.replace(/\D/g, '')}@${PHONE_EMAIL_DOMAIN}`,
        phoneNumber: phone,
        phoneNumberVerified: false,
        role: 'CLIENT',
      },
      select: { id: true },
    });
    return user.id;
  }

  // ------------------------------------------------------------ dono (US4) --

  async ownerDetail(businessId: string, id: string) {
    const appointment = await this.prisma.appointment.findFirst({
      where: { id, businessId },
      select: ownerAppointmentView,
    });
    if (!appointment) throw Errors.notFound('Agendamento');
    if (appointment.isNewForOwner) {
      await this.prisma.appointment.update({ where: { id }, data: { isNewForOwner: false } });
    }
    return appointment;
  }

  async ownerAction(businessId: string, id: string, action: OwnerAction) {
    const current = await this.prisma.appointment.findFirst({
      where: { id, businessId },
      select: { status: true, startsAt: true },
    });
    if (!current) throw Errors.notFound('Agendamento');
    const { from, to } = planOwnerTransition(action, current.status, current.startsAt);
    try {
      const { count } = await this.prisma.appointment.updateMany({
        where: { id, businessId, status: { in: from } },
        data: {
          status: to,
          isNewForOwner: false,
          cancelledBy: to === 'CANCELED' ? 'OWNER' : null,
          completedAt: to === 'COMPLETED' ? new Date() : action === 'reopen' ? null : undefined,
        },
      });
      if (count === 0) throw Errors.invalidTransition();
    } catch (e) {
      // Reabrir sobre horário já ocupado esbarra na exclusion constraint.
      if (isOverlapViolation(e)) throw Errors.slotTaken();
      throw e;
    }
    await this.notifications.appointmentStatusByOwner(id, to);
    return this.prisma.appointment.findUniqueOrThrow({
      where: { id },
      select: ownerAppointmentView,
    });
  }

  // --------------------------------------------------------- cliente (US5) --

  async listMine(
    clientId: string,
    scope: 'upcoming' | 'history',
    p: Pagination = paginationSchema.parse({}),
  ) {
    const now = new Date();
    const where: Prisma.AppointmentWhereInput =
      scope === 'upcoming'
        ? { clientId, status: { in: ['PENDING', 'CONFIRMED'] }, endsAt: { gt: now } }
        : {
            clientId,
            OR: [
              { status: { in: ['COMPLETED', 'CANCELED', 'NO_SHOW'] } },
              { endsAt: { lte: now } },
            ],
          };
    const [items, total] = await Promise.all([
      this.prisma.appointment.findMany({
        where,
        select: appointmentView,
        orderBy: { startsAt: scope === 'upcoming' ? 'asc' : 'desc' },
        ...skipTake(p),
      }),
      this.prisma.appointment.count({ where }),
    ]);
    return toPage(items, total, p);
  }

  async mine(clientId: string, id: string) {
    const appointment = await this.prisma.appointment.findFirst({
      where: { id, clientId },
      select: appointmentView,
    });
    if (!appointment) throw Errors.notFound('Agendamento');
    return appointment;
  }

  async cancelByClient(clientId: string, id: string) {
    const current = await this.prisma.appointment.findFirst({
      where: { id, clientId },
      select: { status: true, startsAt: true },
    });
    if (!current) throw Errors.notFound('Agendamento');
    if (current.status !== 'PENDING' && current.status !== 'CONFIRMED')
      throw Errors.invalidTransition();
    const { cancellationWindowMinutes } = await this.settings.get();
    if (!withinClientWindow(current.startsAt, cancellationWindowMinutes))
      throw Errors.cancellationWindowClosed();
    const { count } = await this.prisma.appointment.updateMany({
      where: { id, clientId, status: { in: ['PENDING', 'CONFIRMED'] } },
      data: { status: 'CANCELED', cancelledBy: 'CLIENT' },
    });
    if (count === 0) throw Errors.invalidTransition();
    await this.notifications.appointmentChangedByClient(id, 'CANCELED');
    return this.mine(clientId, id);
  }

  /** Remarcar = mesmo agendamento, novo horário, mesmas regras e preço registrado (FR-026). */
  async rescheduleByClient(clientId: string, id: string, dto: RescheduleDto) {
    const current = await this.prisma.appointment.findFirst({
      where: { id, clientId },
      select: {
        status: true,
        startsAt: true,
        businessId: true,
        serviceId: true,
        durationMinutes: true,
      },
    });
    if (!current) throw Errors.notFound('Agendamento');
    if (current.status !== 'PENDING' && current.status !== 'CONFIRMED')
      throw Errors.invalidTransition();
    const { cancellationWindowMinutes } = await this.settings.get();
    if (!withinClientWindow(current.startsAt, cancellationWindowMinutes))
      throw Errors.cancellationWindowClosed();
    const business = await this.prisma.business.findFirst({
      where: { id: current.businessId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!business) throw Errors.businessNotActive();

    const date = localDateOf(dto.startsAt);
    try {
      await this.prisma.$transaction(async (tx) => {
        const query = {
          businessId: current.businessId,
          serviceId: current.serviceId,
          date,
          professionalId: dto.professionalId ?? undefined,
          ignoreAppointmentId: id,
        };
        await this.lockProfessionals(tx, await this.availability.loadDay(query, tx));
        const fresh = await this.availability.loadDay(query, tx);
        const free = this.availability.freeAt(fresh, dto.startsAt);
        const professionalId = await this.pickProfessional(tx, free, date);
        await tx.appointment.update({
          where: { id },
          data: {
            professionalId,
            startsAt: dto.startsAt,
            // Duração registrada na reserva continua valendo (Princípio X).
            endsAt: new Date(dto.startsAt.getTime() + current.durationMinutes * 60_000),
            isNewForOwner: true,
            ...reminderFlags(dto.startsAt),
          },
        });
      });
    } catch (e) {
      if (isOverlapViolation(e)) throw Errors.slotTaken();
      throw e;
    }
    await this.notifications.appointmentChangedByClient(id, 'RESCHEDULED');
    return this.mine(clientId, id);
  }
}
