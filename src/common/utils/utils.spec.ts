import { detectImageKind } from './image';
import { maskEmail, maskPhone } from './mask';
import { normalizeBrPhone } from './phone';
import { normalizeText, slugify } from './text';
import {
  addDaysToDate,
  dayBounds,
  localDateOf,
  minutesOfDay,
  weekdayOf,
  zonedInstant,
} from './time';

describe('text', () => {
  it('normaliza acentos, caixa e espaços', () => {
    expect(normalizeText('  Design   de SOBRANCELHAS  ')).toBe('design de sobrancelhas');
    expect(normalizeText('Estética Ação')).toBe('estetica acao');
  });

  it('gera slug seguro', () => {
    expect(slugify('Studio Bella & Cia — Setor Bueno!')).toBe('studio-bella-cia-setor-bueno');
    expect(slugify('***')).toBe('');
  });
});

describe('phone', () => {
  it('normaliza celulares brasileiros para E.164', () => {
    expect(normalizeBrPhone('(62) 99999-0000')).toBe('+5562999990000');
    expect(normalizeBrPhone('+55 62 99999 0000')).toBe('+5562999990000');
  });

  it('recusa fixo, DDD inválido e lixo', () => {
    expect(normalizeBrPhone('(62) 3333-0000')).toBeNull();
    expect(normalizeBrPhone('(01) 99999-0000')).toBeNull();
    expect(normalizeBrPhone('abc')).toBeNull();
  });
});

describe('mask', () => {
  it('nunca expõe o número inteiro', () => {
    expect(maskPhone('+5562999990000')).toBe('+5562*****0000');
    expect(maskEmail('joana@exemplo.com')).toBe('jo***@exemplo.com');
  });
});

describe('time (America/Sao_Paulo)', () => {
  it('converte minutos locais para instante UTC (UTC-3)', () => {
    expect(zonedInstant('2026-11-02', 9 * 60).toISOString()).toBe('2026-11-02T12:00:00.000Z');
  });

  it('usa o calendário local na virada do dia', () => {
    // 01:30 UTC de 3/11 ainda é 22:30 de 2/11 em São Paulo.
    const instant = new Date('2026-11-03T01:30:00.000Z');
    expect(localDateOf(instant)).toBe('2026-11-02');
    expect(minutesOfDay(instant)).toBe(22 * 60 + 30);
  });

  it('calcula dia da semana, soma de dias e limites do dia', () => {
    expect(weekdayOf('2026-11-01')).toBe(0); // domingo
    expect(addDaysToDate('2026-12-31', 1)).toBe('2027-01-01');
    const { start, end } = dayBounds('2026-11-02');
    expect(start.toISOString()).toBe('2026-11-02T03:00:00.000Z');
    expect(end.toISOString()).toBe('2026-11-03T03:00:00.000Z');
  });
});

describe('detectImageKind', () => {
  const pad = (bytes: number[]) => Buffer.concat([Buffer.from(bytes), Buffer.alloc(16)]);

  it('reconhece JPEG, PNG e WebP pelo conteúdo', () => {
    expect(detectImageKind(pad([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
    expect(detectImageKind(pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('png');
    const webp = Buffer.alloc(16);
    webp.write('RIFF', 0, 'ascii');
    webp.write('WEBP', 8, 'ascii');
    expect(detectImageKind(webp)).toBe('webp');
  });

  it('recusa SVG e arquivos com extensão falsa', () => {
    expect(
      detectImageKind(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')),
    ).toBeNull();
    expect(detectImageKind(Buffer.from('%PDF-1.7 fake image content'))).toBeNull();
    expect(detectImageKind(Buffer.alloc(4))).toBeNull();
  });
});
