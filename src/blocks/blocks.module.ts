import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Injectable,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Business } from '@prisma/client';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { Roles } from '../auth/decorators';
import { BusinessesModule } from '../businesses/businesses.module';
import {
  ActiveBusinessRequired,
  OwnerBusiness,
  OwnerBusinessGuard,
} from '../businesses/owner-business.guard';
import { Errors } from '../common/errors';
import { DATE_REGEX, dayBounds, zonedInstant } from '../common/utils/time';
import { PrismaService } from '../prisma/prisma.service';

const DURATIONS = { '1h': 60, '2h': 120, '4h': 240, day: null } as const;

const createBlockSchema = z
  .object({
    professionalId: z.string().uuid(),
    date: z.string().regex(DATE_REGEX, 'Use YYYY-MM-DD'),
    start: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM')
      .optional(),
    duration: z.enum(['1h', '2h', '4h', 'day']),
    reason: z.enum(['APPOINTMENT', 'DAY_OFF', 'EXTENDED_LUNCH', 'COURSE']),
  })
  .strict()
  .refine((v) => v.duration === 'day' || Boolean(v.start), 'Informe o início');
class CreateBlockDto extends createZodDto(createBlockSchema) {}

const listBlocksSchema = z
  .object({
    from: z.string().regex(DATE_REGEX),
    to: z.string().regex(DATE_REGEX),
    professionalId: z.string().uuid().optional(),
  })
  .strict();
class ListBlocksQuery extends createZodDto(listBlocksSchema) {}

const blockSelect = {
  id: true,
  professionalId: true,
  startsAt: true,
  endsAt: true,
  reason: true,
} as const;

@Injectable()
export class BlocksService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Bloqueio some da agenda online na hora (a disponibilidade lê time_blocks).
   * Agendamentos sobrepostos voltam como aviso; nenhum é cancelado (FR-030).
   */
  async create(businessId: string, dto: CreateBlockDto) {
    const professional = await this.prisma.professional.findFirst({
      where: { id: dto.professionalId, businessId },
      select: { id: true },
    });
    if (!professional) throw Errors.notFound('Profissional');

    const minutes = DURATIONS[dto.duration];
    const [h, m] = (dto.start ?? '00:00').split(':').map(Number);
    const { start: dayStart, end: dayEnd } = dayBounds(dto.date);
    const startsAt = minutes === null ? dayStart : zonedInstant(dto.date, h * 60 + m);
    const endsAt = minutes === null ? dayEnd : new Date(startsAt.getTime() + minutes * 60_000);

    const block = await this.prisma.timeBlock.create({
      data: { businessId, professionalId: professional.id, startsAt, endsAt, reason: dto.reason },
      select: blockSelect,
    });
    const conflicts = await this.prisma.appointment.findMany({
      where: {
        businessId,
        professionalId: professional.id,
        status: { in: ['PENDING', 'CONFIRMED'] },
        startsAt: { lt: endsAt },
        endsAt: { gt: startsAt },
      },
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        serviceName: true,
        client: { select: { name: true } },
      },
    });
    return { block, conflicts };
  }

  list(businessId: string, q: ListBlocksQuery) {
    return this.prisma.timeBlock.findMany({
      where: {
        businessId,
        professionalId: q.professionalId,
        startsAt: { lt: dayBounds(q.to).end },
        endsAt: { gt: dayBounds(q.from).start },
      },
      select: blockSelect,
      orderBy: { startsAt: 'asc' },
    });
  }

  async remove(businessId: string, id: string): Promise<void> {
    const { count } = await this.prisma.timeBlock.deleteMany({ where: { id, businessId } });
    if (count === 0) throw Errors.notFound('Bloqueio');
  }
}

@ApiTags('Dono · Bloqueios')
@Roles('BUSINESS_OWNER')
@UseGuards(OwnerBusinessGuard)
@ActiveBusinessRequired()
@Controller('owner/blocks')
export class OwnerBlocksController {
  constructor(private readonly blocks: BlocksService) {}

  @Get()
  list(@OwnerBusiness() business: Business, @Query() query: ListBlocksQuery) {
    return this.blocks.list(business.id, query);
  }

  @Post()
  create(@OwnerBusiness() business: Business, @Body() dto: CreateBlockDto) {
    return this.blocks.create(business.id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@OwnerBusiness() business: Business, @Param('id', ParseUUIDPipe) id: string) {
    return this.blocks.remove(business.id, id);
  }
}

@Module({
  imports: [BusinessesModule],
  controllers: [OwnerBlocksController],
  providers: [BlocksService],
})
export class BlocksModule {}
