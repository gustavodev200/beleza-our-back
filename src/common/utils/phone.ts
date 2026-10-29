import { z } from 'zod';

/** Celular brasileiro em E.164: +55 + DDD (2) + 9 dígitos começando com 9. */
export const BR_MOBILE_REGEX = /^\+55[1-9]{2}9\d{8}$/;

/** Aceita "(62) 99999-0000", "62999990000" ou "+5562999990000" e devolve E.164. */
export function normalizeBrPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  const withCountry = digits.length === 11 ? `55${digits}` : digits;
  const e164 = `+${withCountry}`;
  return BR_MOBILE_REGEX.test(e164) ? e164 : null;
}

export const brPhoneSchema = z
  .string()
  .trim()
  .min(10)
  .max(20)
  .transform((value, ctx) => {
    const phone = normalizeBrPhone(value);
    if (!phone) {
      ctx.addIssue({ code: 'custom', message: 'Celular inválido' });
      return z.NEVER;
    }
    return phone;
  });
