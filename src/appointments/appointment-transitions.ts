import type { AppointmentStatus } from '@prisma/client';
import { Errors } from '../common/errors';

export const OWNER_ACTIONS = ['confirm', 'complete', 'cancel', 'no-show', 'reopen'] as const;
export type OwnerAction = (typeof OWNER_ACTIONS)[number];

const RULES: Record<
  OwnerAction,
  { from: AppointmentStatus[]; to: AppointmentStatus; requiresStarted?: boolean }
> = {
  confirm: { from: ['PENDING'], to: 'CONFIRMED' },
  complete: { from: ['CONFIRMED'], to: 'COMPLETED', requiresStarted: true },
  'no-show': { from: ['CONFIRMED'], to: 'NO_SHOW', requiresStarted: true },
  cancel: { from: ['PENDING', 'CONFIRMED'], to: 'CANCELED' },
  reopen: { from: ['COMPLETED', 'CANCELED', 'NO_SHOW'], to: 'CONFIRMED' },
};

/** Status de destino para a ação do dono (FR-028); lança se a transição não é permitida. */
export function planOwnerTransition(
  action: OwnerAction,
  current: AppointmentStatus,
  startsAt: Date,
  now = new Date(),
): { from: AppointmentStatus[]; to: AppointmentStatus } {
  const rule = RULES[action];
  if (!rule.from.includes(current)) throw Errors.invalidTransition();
  if (rule.requiresStarted && startsAt > now) {
    throw Errors.unprocessable('APPOINTMENT_NOT_STARTED', 'O atendimento ainda não começou');
  }
  return { from: rule.from, to: rule.to };
}

/** Cliente cancela/remarca até `windowMinutes` antes do início, inclusive o instante limite (FR-027). */
export function withinClientWindow(
  startsAt: Date,
  windowMinutes: number,
  now = new Date(),
): boolean {
  return now.getTime() <= startsAt.getTime() - windowMinutes * 60_000;
}
