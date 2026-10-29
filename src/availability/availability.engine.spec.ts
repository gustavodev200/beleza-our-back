import { computeSlots, structuralStarts, type EngineInput } from './availability.engine';

const DATE = '2026-11-02'; // segunda-feira
const at = (hhmm: string) => new Date(`${DATE}T${hhmm}:00.000-03:00`);
const hhmm = (d: Date) => new Date(d.getTime() - 3 * 3_600_000).toISOString().slice(11, 16);

const base: EngineInput = {
  date: DATE,
  schedule: { opensAt: 9 * 60, closesAt: 18 * 60, breakStart: 12 * 60, breakEnd: 13 * 60 },
  durationMinutes: 60,
  professionals: [{ id: 'ana', busy: [] }],
  now: new Date('2026-11-01T12:00:00.000Z'),
};

describe('computeSlots', () => {
  it('gera inícios a cada 15 min dentro do expediente, terminando até o fechamento', () => {
    const starts = computeSlots(base).map((s) => hhmm(s.startsAt));
    expect(starts[0]).toBe('09:00');
    expect(starts).toContain('11:00');
    expect(starts.at(-1)).toBe('17:00');
    expect(starts).not.toContain('17:15');
  });

  it('não invade a pausa de almoço', () => {
    const starts = computeSlots(base).map((s) => hhmm(s.startsAt));
    expect(starts).not.toContain('11:15'); // terminaria 12:15
    expect(starts).not.toContain('12:00');
    expect(starts).not.toContain('12:45');
    expect(starts).toContain('13:00');
  });

  it('dia fechado não tem horários', () => {
    expect(computeSlots({ ...base, schedule: null })).toEqual([]);
  });

  it('ignora horários no passado (inclusive o instante atual)', () => {
    const starts = computeSlots({ ...base, now: at('10:00') }).map((s) => hhmm(s.startsAt));
    expect(starts[0]).toBe('10:15');
  });

  it('agendamento ou bloqueio sobreposto ocupa o horário; encostado não', () => {
    const busy = [{ start: at('14:00'), end: at('15:00') }];
    const starts = computeSlots({ ...base, professionals: [{ id: 'ana', busy }] }).map((s) =>
      hhmm(s.startsAt),
    );
    expect(starts).not.toContain('13:15');
    expect(starts).not.toContain('14:45');
    expect(starts).toContain('13:00'); // 13:00–14:00 encosta
    expect(starts).toContain('15:00');
  });

  it('bloqueio de dia inteiro remove todos os horários da profissional', () => {
    const busy = [{ start: at('00:00'), end: new Date(at('00:00').getTime() + 86_400_000) }];
    expect(computeSlots({ ...base, professionals: [{ id: 'ana', busy }] })).toEqual([]);
  });

  it('sem preferência: livre se ao menos uma profissional apta estiver livre', () => {
    const slots = computeSlots({
      ...base,
      professionals: [
        { id: 'ana', busy: [{ start: at('09:00'), end: at('10:00') }] },
        { id: 'bia', busy: [] },
      ],
    });
    const nine = slots.find((s) => hhmm(s.startsAt) === '09:00');
    expect(nine?.professionalIds).toEqual(['bia']);
    const ten = slots.find((s) => hhmm(s.startsAt) === '10:00');
    expect(ten?.professionalIds).toEqual(['ana', 'bia']);
  });

  it('serviço mais longo que o expediente não gera horário', () => {
    expect(computeSlots({ ...base, durationMinutes: 600 })).toEqual([]);
  });

  it('structuralStarts não depende de ocupação', () => {
    expect(structuralStarts(base).length).toBeGreaterThan(
      computeSlots({
        ...base,
        professionals: [{ id: 'ana', busy: [{ start: at('09:00'), end: at('18:00') }] }],
      }).length,
    );
  });
});
