import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { Errors } from '../common/errors';
import { addDaysToDate, dayBounds, localDateOf, weekdayOf } from '../common/utils/time';
import { PrismaService } from '../prisma/prisma.service';
import {
  computeSlots,
  parseBreaks,
  structuralStarts,
  type EngineInput,
  type ProfessionalAgenda,
  type Slot,
} from './availability.engine';

/** Clientes veem hoje + 6 dias (FR-020); balcão do dono pode agendar mais longe. */
export const CLIENT_WINDOW_DAYS = 7;
export const OWNER_WINDOW_DAYS = 60;

export interface SlotQuery {
  businessId: string;
  serviceId: string;
  date: string;
  professionalId?: string;
  windowDays?: number;
  /** Agendamento a ignorar (remarcação: o horário atual da própria cliente não conta como ocupado). */
  ignoreAppointmentId?: string;
}

export interface DayContext {
  input: EngineInput;
  service: { id: string; name: string; durationMinutes: number; priceCents: number };
}

type Db = Prisma.TransactionClient;

@Injectable()
export class AvailabilityService {
  constructor(private readonly prisma: PrismaService) {}

  assertDateInWindow(date: string, windowDays: number, now = new Date()): void {
    const today = localDateOf(now);
    const last = addDaysToDate(today, windowDays - 1);
    if (date < today || date > last) {
      throw Errors.unprocessable('DATE_OUT_OF_RANGE', 'Data fora do período de agendamento');
    }
  }

  /** Carrega tudo que a regra precisa para um dia (≤ 5 queries). */
  async loadDay(q: SlotQuery, db: Db = this.prisma, now = new Date()): Promise<DayContext> {
    this.assertDateInWindow(q.date, q.windowDays ?? CLIENT_WINDOW_DAYS, now);
    const service = await db.service.findFirst({
      where: { id: q.serviceId, businessId: q.businessId, visible: true },
      select: { id: true, name: true, durationMinutes: true, priceCents: true },
    });
    if (!service) throw Errors.notFound('Serviço');

    const professionals = await db.professional.findMany({
      where: {
        businessId: q.businessId,
        active: true,
        services: { some: { serviceId: service.id } },
        ...(q.professionalId ? { id: q.professionalId } : {}),
      },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    if (q.professionalId && professionals.length === 0) throw Errors.notFound('Profissional');

    const ids = professionals.map((p) => p.id);
    const { start, end } = dayBounds(q.date);
    const [hours, appointments, blocks] = await Promise.all([
      db.businessHours.findUnique({
        where: { businessId_weekday: { businessId: q.businessId, weekday: weekdayOf(q.date) } },
      }),
      db.appointment.findMany({
        where: {
          professionalId: { in: ids },
          status: { in: ['PENDING', 'CONFIRMED'] },
          startsAt: { lt: end },
          endsAt: { gt: start },
          ...(q.ignoreAppointmentId ? { id: { not: q.ignoreAppointmentId } } : {}),
        },
        select: { professionalId: true, startsAt: true, endsAt: true },
      }),
      db.timeBlock.findMany({
        // Bloqueio sem profissional fecha o estabelecimento todo.
        where: {
          businessId: q.businessId,
          OR: [{ professionalId: { in: ids } }, { professionalId: null }],
          startsAt: { lt: end },
          endsAt: { gt: start },
        },
        select: { professionalId: true, startsAt: true, endsAt: true },
      }),
    ]);

    const agendas: ProfessionalAgenda[] = ids.map((id) => ({
      id,
      busy: [...appointments, ...blocks]
        .filter((b) => b.professionalId === id || b.professionalId === null)
        .map((b) => ({ start: b.startsAt, end: b.endsAt })),
    }));

    return {
      service,
      input: {
        date: q.date,
        schedule: hours
          ? {
              opensAt: hours.opensAt,
              closesAt: hours.closesAt,
              breaks: parseBreaks(hours.breaks),
            }
          : null,
        durationMinutes: service.durationMinutes,
        professionals: agendas,
        now,
      },
    };
  }

  async slots(q: SlotQuery): Promise<Slot[]> {
    const { input } = await this.loadDay(q);
    return computeSlots(input);
  }

  /**
   * Profissionais livres exatamente em `startsAt`. Distingue horário que não
   * existe na grade (SLOT_UNAVAILABLE) de horário tomado (SLOT_TAKEN).
   */
  freeAt(ctx: DayContext, startsAt: Date): string[] {
    const exists = structuralStarts(ctx.input).some((s) => s.getTime() === startsAt.getTime());
    if (!exists) throw Errors.slotUnavailable();
    const slot = computeSlots(ctx.input).find((s) => s.startsAt.getTime() === startsAt.getTime());
    if (!slot) throw Errors.slotTaken();
    return slot.professionalIds;
  }

  /** Próximos horários livres de qualquer serviço visível (cards e perfil público). */
  async nextFreeSlots(
    businessId: string,
    limit: number,
    now = new Date(),
  ): Promise<{ startsAt: Date; serviceId: string }[]> {
    const service = await this.prisma.service.findFirst({
      where: {
        businessId,
        visible: true,
        professionals: { some: { professional: { active: true } } },
      },
      orderBy: [{ durationMinutes: 'asc' }, { priceCents: 'asc' }],
      select: { id: true },
    });
    if (!service) return [];
    const result: { startsAt: Date; serviceId: string }[] = [];
    const today = localDateOf(now);
    for (let i = 0; i < CLIENT_WINDOW_DAYS && result.length < limit; i += 1) {
      const date = addDaysToDate(today, i);
      const { input } = await this.loadDay(
        { businessId, serviceId: service.id, date },
        this.prisma,
        now,
      );
      for (const slot of computeSlots(input)) {
        if (result.length >= limit) break;
        result.push({ startsAt: slot.startsAt, serviceId: service.id });
      }
    }
    return result;
  }

  async hasSlotToday(businessId: string, now = new Date()): Promise<boolean> {
    const services = await this.prisma.service.findMany({
      where: {
        businessId,
        visible: true,
        professionals: { some: { professional: { active: true } } },
      },
      select: { id: true },
    });
    const today = localDateOf(now);
    for (const s of services) {
      const { input } = await this.loadDay(
        { businessId, serviceId: s.id, date: today },
        this.prisma,
        now,
      );
      if (computeSlots(input).length) return true;
    }
    return false;
  }
}
