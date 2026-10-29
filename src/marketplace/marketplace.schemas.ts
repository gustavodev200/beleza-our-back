import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { paginationSchema } from '../common/utils/pagination';

// Slug "goianesia-go": filtra também cidades ainda sem cadastro (resultado vazio, não "todas").
const citySlug = z
  .string()
  .regex(/^[a-z0-9-]{1,100}$/)
  .optional();

export const searchSchema = paginationSchema
  .extend({
    // Cada card calcula os próximos horários: página menor que o padrão global.
    pageSize: z.coerce.number().int().min(1).max(20).default(12),
    q: z.string().trim().max(80).optional(),
    cityId: z.string().uuid().optional(),
    citySlug,
    categoryId: z.string().uuid().optional(),
    neighborhood: z.string().trim().max(60).optional(),
    availableToday: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => v === 'true'),
    sort: z.enum(['relevance', 'distance', 'rating', 'price']).default('relevance'),
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
  })
  .strict();
export type SearchQuery = z.infer<typeof searchSchema>;
export class SearchQueryDto extends createZodDto(searchSchema) {}

export class ReviewsQueryDto extends createZodDto(paginationSchema.strict()) {}

export class FeaturedQueryDto extends createZodDto(z.object({ cityId: z.string().uuid().optional(), citySlug }).strict()) {}
