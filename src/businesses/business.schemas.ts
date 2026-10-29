import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { brPhoneSchema } from '../common/utils/phone';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === '' ? undefined : v));

const businessFields = {
  type: z.enum(['SALON', 'BARBERSHOP', 'STUDIO', 'AUTONOMOUS', 'AESTHETICS']),
  name: z.string().trim().min(2).max(80),
  whatsapp: brPhoneSchema,
  phone: optionalText(20),
  cityId: z.string().uuid(),
  neighborhood: z.string().trim().min(2).max(60),
  address: optionalText(160),
  description: optionalText(1000),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  categoryIds: z.array(z.string().uuid()).min(1).max(7),
  requiresConfirmation: z.boolean().optional(),
};

export const createBusinessSchema = z.object(businessFields).strict();
export class CreateBusinessDto extends createZodDto(createBusinessSchema) {}

export const updateBusinessSchema = z
  .object(businessFields)
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Nada para atualizar');
export class UpdateBusinessDto extends createZodDto(updateBusinessSchema) {}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const time = z.string().regex(HHMM, 'Use HH:MM');
export const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

const daySchema = z
  .object({
    weekday: z.number().int().min(0).max(6),
    opensAt: time,
    closesAt: time,
    breakStart: time.optional(),
    breakEnd: time.optional(),
  })
  .strict()
  .superRefine((d, ctx) => {
    const open = toMinutes(d.opensAt);
    const close = toMinutes(d.closesAt);
    if (open >= close)
      ctx.addIssue({ code: 'custom', message: 'Abertura deve ser antes do fechamento' });
    if (Boolean(d.breakStart) !== Boolean(d.breakEnd)) {
      ctx.addIssue({ code: 'custom', message: 'Informe início e fim da pausa' });
    }
    if (d.breakStart && d.breakEnd) {
      const bs = toMinutes(d.breakStart);
      const be = toMinutes(d.breakEnd);
      if (!(open <= bs && bs < be && be <= close)) {
        ctx.addIssue({ code: 'custom', message: 'Pausa deve estar dentro do expediente' });
      }
    }
  });

export const hoursSchema = z
  .object({ days: z.array(daySchema).max(7) })
  .strict()
  .refine(
    (v) => new Set(v.days.map((d) => d.weekday)).size === v.days.length,
    'Dia da semana repetido',
  );
export class HoursDto extends createZodDto(hoursSchema) {}
