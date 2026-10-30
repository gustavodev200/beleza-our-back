import { zonedInstant } from '../common/utils/time';

export const SLOT_STEP_MINUTES = 15;

/** Pausa [start, end) em minutos desde 00:00. */
export interface Break {
  start: number;
  end: number;
}

/** Expediente do dia em minutos desde 00:00 (fuso SP). */
export interface DaySchedule {
  opensAt: number;
  closesAt: number;
  breaks: Break[];
}

/** Coluna JSON `breaks` → lista tipada (tolera null/legado). */
export function parseBreaks(value: unknown): Break[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (b): b is Break =>
        typeof b === 'object' &&
        b !== null &&
        typeof (b as Break).start === 'number' &&
        typeof (b as Break).end === 'number',
    )
    .map(({ start, end }) => ({ start, end }))
    .sort((a, b) => a.start - b.start);
}

/** Aberto no minuto: dentro do expediente e fora de todas as pausas. */
export function isOpenAt(schedule: DaySchedule, minute: number): boolean {
  return (
    minute >= schedule.opensAt &&
    minute < schedule.closesAt &&
    !schedule.breaks.some((b) => minute >= b.start && minute < b.end)
  );
}

export interface Interval {
  start: Date;
  end: Date;
}

export interface ProfessionalAgenda {
  id: string;
  /** Agendamentos PENDING/CONFIRMED e bloqueios do dia. */
  busy: Interval[];
}

export interface EngineInput {
  /** Data de calendário YYYY-MM-DD em São Paulo. */
  date: string;
  /** null = estabelecimento fechado no dia. */
  schedule: DaySchedule | null;
  durationMinutes: number;
  professionals: ProfessionalAgenda[];
  now: Date;
}

export interface Slot {
  startsAt: Date;
  /** Profissionais livres neste início (ordem de entrada). */
  professionalIds: string[];
}

const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;

/**
 * Inícios possíveis pela grade do dia, sem olhar ocupação: dentro do
 * expediente, fora das pausas, terminando até o fechamento e no futuro.
 */
export function structuralStarts(input: Omit<EngineInput, 'professionals'>): Date[] {
  const { schedule, durationMinutes, date, now } = input;
  if (!schedule) return [];
  const starts: Date[] = [];
  for (let m = schedule.opensAt; m + durationMinutes <= schedule.closesAt; m += SLOT_STEP_MINUTES) {
    const end = m + durationMinutes;
    const hitsBreak = schedule.breaks.some((b) => m < b.end && b.start < end);
    if (hitsBreak) continue;
    const startsAt = zonedInstant(date, m);
    if (startsAt <= now) continue;
    starts.push(startsAt);
  }
  return starts;
}

/**
 * Regra única de disponibilidade (FR-021, Princípio IX), usada tanto para
 * listar horários quanto para validar a reserva dentro da transação.
 */
export function computeSlots(input: EngineInput): Slot[] {
  const slots: Slot[] = [];
  for (const startsAt of structuralStarts(input)) {
    const candidate = {
      start: startsAt,
      end: new Date(startsAt.getTime() + input.durationMinutes * 60_000),
    };
    const free = input.professionals
      .filter((p) => !p.busy.some((b) => overlaps(candidate, b)))
      .map((p) => p.id);
    if (free.length) slots.push({ startsAt, professionalIds: free });
  }
  return slots;
}
