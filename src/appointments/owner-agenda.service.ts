import { Injectable } from '@nestjs/common';
import { parseBreaks } from '../availability/availability.engine';
import { Errors } from '../common/errors';
import { skipTake, toPage, type Pagination } from '../common/utils/pagination';
import { addDaysToDate, dayBounds, localDateOf } from '../common/utils/time';
import { PrismaService } from '../prisma/prisma.service';
import { ownerAppointmentView } from './appointments.service';

export const MAX_AGENDA_DAYS = 14;

@Injectable()
export class OwnerAgendaService {
  constructor(private readonly prisma: PrismaService) {}

  /** Semana/dia: agendamentos, bloqueios, expediente e profissionais (FR-031). */
  async agenda(businessId: string, from: string, to: string, professionalIds?: string[]) {
    if (to < from || to > addDaysToDate(from, MAX_AGENDA_DAYS - 1)) {
      throw Errors.unprocessable('INVALID_RANGE', `Período deve ter até ${MAX_AGENDA_DAYS} dias`);
    }
    const start = dayBounds(from).start;
    const end = dayBounds(to).end;
    const professionalFilter = professionalIds?.length
      ? { professionalId: { in: professionalIds } }
      : {};
    const [appointments, blocks, hours, professionals] = await Promise.all([
      this.prisma.appointment.findMany({
        where: { businessId, startsAt: { lt: end }, endsAt: { gt: start }, ...professionalFilter },
        select: ownerAppointmentView,
        orderBy: { startsAt: 'asc' },
      }),
      this.prisma.timeBlock.findMany({
        where: {
          businessId,
          startsAt: { lt: end },
          endsAt: { gt: start },
          // Pausa do estabelecimento todo aparece em qualquer filtro.
          ...(professionalIds?.length
            ? { OR: [{ professionalId: { in: professionalIds } }, { professionalId: null }] }
            : {}),
        },
        select: { id: true, professionalId: true, startsAt: true, endsAt: true, reason: true },
        orderBy: { startsAt: 'asc' },
      }),
      this.prisma.businessHours.findMany({ where: { businessId }, orderBy: { weekday: 'asc' } }),
      this.prisma.professional.findMany({
        where: { businessId },
        select: { id: true, name: true, active: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    return {
      from,
      to,
      appointments,
      blocks,
      professionals,
      hours: hours.map(({ weekday, opensAt, closesAt, breaks }) => ({
        weekday,
        opensAt,
        closesAt,
        breaks: parseBreaks(breaks),
      })),
    };
  }

  /** Visão geral do dia: cards, agenda de hoje e "novos e pendentes". */
  async overview(businessId: string, date = localDateOf(new Date())) {
    const { start, end } = dayBounds(date);
    const [today, newAndPending] = await Promise.all([
      this.prisma.appointment.findMany({
        where: { businessId, startsAt: { gte: start, lt: end }, status: { not: 'CANCELED' } },
        select: ownerAppointmentView,
        orderBy: { startsAt: 'asc' },
      }),
      this.prisma.appointment.findMany({
        where: {
          businessId,
          endsAt: { gt: new Date() },
          OR: [{ status: 'PENDING' }, { isNewForOwner: true, status: 'CONFIRMED' }],
        },
        select: ownerAppointmentView,
        orderBy: { startsAt: 'asc' },
        take: 20,
      }),
    ]);
    const active = today.filter((a) => a.status !== 'NO_SHOW');
    return {
      date,
      appointmentsToday: active.length,
      expectedRevenueCents: active.reduce((sum, a) => sum + a.priceCents, 0),
      awaitingAction: newAndPending.filter((a) => a.status === 'PENDING').length,
      today,
      newAndPending,
    };
  }

  /** Clientes que já agendaram neste estabelecimento (sem dados de outros estabelecimentos). */
  async clients(businessId: string, p: Pagination) {
    const where = { appointments: { some: { businessId } }, anonymizedAt: null };
    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          phoneNumber: true,
          appointments: {
            where: { businessId },
            select: { startsAt: true, status: true },
            orderBy: { startsAt: 'desc' },
          },
        },
        orderBy: { name: 'asc' },
        ...skipTake(p),
      }),
      this.prisma.user.count({ where }),
    ]);
    return toPage(
      users.map((u) => ({
        id: u.id,
        name: u.name,
        phoneNumber: u.phoneNumber,
        appointmentsCount: u.appointments.length,
        lastAppointmentAt: u.appointments[0]?.startsAt ?? null,
        noShows: u.appointments.filter((a) => a.status === 'NO_SHOW').length,
      })),
      total,
      p,
    );
  }
}
