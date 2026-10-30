import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { brPhoneSchema } from '../common/utils/phone';
import { paginationSchema } from '../common/utils/pagination';
import { DATE_REGEX } from '../common/utils/time';

const instant = z
  .string()
  .datetime({ offset: true })
  .transform((v) => new Date(v));
const notes = z.string().trim().max(300).optional();

export const createAppointmentSchema = z
  .object({
    businessId: z.string().uuid(),
    serviceId: z.string().uuid(),
    professionalId: z.string().uuid().nullish(),
    startsAt: instant,
    notes,
    clientName: z.string().trim().min(2).max(80),
    // Só para a conta por e-mail que ainda não tem telefone; ignorado se já tiver.
    clientPhone: brPhoneSchema.optional(),
    // Consentimento explícito para mensagens no WhatsApp (LGPD, FR-070).
    whatsappConsent: z.literal(true),
  })
  .strict();
export class CreateAppointmentDto extends createZodDto(createAppointmentSchema) {}

export const counterAppointmentSchema = z
  .object({
    clientName: z.string().trim().min(2).max(80),
    clientPhone: brPhoneSchema,
    serviceId: z.string().uuid(),
    professionalId: z.string().uuid(),
    startsAt: instant,
    notes,
  })
  .strict();
export class CounterAppointmentDto extends createZodDto(counterAppointmentSchema) {}

export const rescheduleSchema = z
  .object({ startsAt: instant, professionalId: z.string().uuid().nullish() })
  .strict();
export class RescheduleDto extends createZodDto(rescheduleSchema) {}

export const availabilityQuerySchema = z
  .object({
    serviceId: z.string().uuid(),
    date: z.string().regex(DATE_REGEX, 'Use YYYY-MM-DD'),
    professionalId: z.string().uuid().optional(),
  })
  .strict();
export class AvailabilityQuery extends createZodDto(availabilityQuerySchema) {}

export const myAppointmentsQuerySchema = paginationSchema
  .extend({ scope: z.enum(['upcoming', 'history']).default('upcoming') })
  .strict();
export class MyAppointmentsQuery extends createZodDto(myAppointmentsQuerySchema) {}
