import { planOwnerTransition, withinClientWindow } from './appointment-transitions';

const now = new Date('2026-11-02T15:00:00.000Z');
const past = new Date('2026-11-02T14:00:00.000Z');
const future = new Date('2026-11-02T16:00:00.000Z');

describe('planOwnerTransition', () => {
  it('confirma apenas pendentes', () => {
    expect(planOwnerTransition('confirm', 'PENDING', future, now).to).toBe('CONFIRMED');
    expect(() => planOwnerTransition('confirm', 'CONFIRMED', future, now)).toThrow();
  });

  it('conclui e marca ausência só depois do início', () => {
    expect(planOwnerTransition('complete', 'CONFIRMED', past, now).to).toBe('COMPLETED');
    expect(planOwnerTransition('no-show', 'CONFIRMED', past, now).to).toBe('NO_SHOW');
    expect(() => planOwnerTransition('complete', 'CONFIRMED', future, now)).toThrow(/não começou/);
    expect(() => planOwnerTransition('complete', 'PENDING', past, now)).toThrow();
  });

  it('cancela ativos e reabre encerrados', () => {
    expect(planOwnerTransition('cancel', 'PENDING', future, now).to).toBe('CANCELED');
    expect(planOwnerTransition('cancel', 'CONFIRMED', future, now).to).toBe('CANCELED');
    expect(() => planOwnerTransition('cancel', 'COMPLETED', past, now)).toThrow();
    for (const status of ['COMPLETED', 'CANCELED', 'NO_SHOW'] as const) {
      expect(planOwnerTransition('reopen', status, past, now).to).toBe('CONFIRMED');
    }
    expect(() => planOwnerTransition('reopen', 'CONFIRMED', past, now)).toThrow();
  });
});

describe('withinClientWindow', () => {
  it('aceita até o instante limite, inclusive', () => {
    const startsAt = new Date(now.getTime() + 120 * 60_000);
    expect(withinClientWindow(startsAt, 120, now)).toBe(true);
    expect(withinClientWindow(startsAt, 121, now)).toBe(false);
    expect(withinClientWindow(new Date(now.getTime() + 3 * 3_600_000), 120, now)).toBe(true);
  });
});
