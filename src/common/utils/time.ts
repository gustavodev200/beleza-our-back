import { TZDate } from '@date-fns/tz';
import { addDays, format } from 'date-fns';

export const TIMEZONE = 'America/Sao_Paulo';

/** Data de calendário (YYYY-MM-DD) do instante no fuso de São Paulo. */
export function localDateOf(instant: Date): string {
  return format(new TZDate(instant, TIMEZONE), 'yyyy-MM-dd');
}

/** Dia da semana (0 = domingo) de uma data de calendário. */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Instante UTC correspondente a `minutes` após a meia-noite de `date` em São Paulo. */
export function zonedInstant(date: string, minutes: number): Date {
  const [y, m, d] = date.split('-').map(Number);
  const local = new TZDate(y, m - 1, d, 0, 0, 0, 0, TIMEZONE);
  return new Date(local.getTime() + minutes * 60_000);
}

/** Minutos desde a meia-noite (fuso SP) de um instante. */
export function minutesOfDay(instant: Date): number {
  const z = new TZDate(instant, TIMEZONE);
  return z.getHours() * 60 + z.getMinutes();
}

export function addDaysToDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return format(addDays(new Date(Date.UTC(y, m - 1, d, 12)), days), 'yyyy-MM-dd');
}

/** Início e fim (exclusivo) do dia de calendário em São Paulo, como instantes UTC. */
export function dayBounds(date: string): { start: Date; end: Date } {
  return { start: zonedInstant(date, 0), end: zonedInstant(addDaysToDate(date, 1), 0) };
}

export const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
