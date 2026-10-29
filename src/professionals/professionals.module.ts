import {
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Business, Prisma } from '@prisma/client';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { Roles } from '../auth/decorators';
import { BusinessesModule } from '../businesses/businesses.module';
import { BusinessesService } from '../businesses/businesses.service';
import { OwnerBusiness, OwnerBusinessGuard } from '../businesses/owner-business.guard';
import { Errors } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

const fields = {
  name: z.string().trim().min(2).max(80),
  role: z.string().trim().max(60).optional(),
  photoUrl: z.string().url().startsWith('https://').max(500).optional(),
  serviceIds: z.array(z.string().uuid()).max(100),
  active: z.boolean().optional(),
};
const createSchema = z.object(fields).strict();
const updateSchema = z
  .object(fields)
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Nada para atualizar');
class CreateProfessionalDto extends createZodDto(createSchema) {}
class UpdateProfessionalDto extends createZodDto(updateSchema) {}

const professionalSelect = {
  id: true,
  name: true,
  role: true,
  photoUrl: true,
  active: true,
  services: { select: { serviceId: true } },
} as const;

@Injectable()
export class ProfessionalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly businesses: BusinessesService,
    private readonly settings: SettingsService,
  ) {}

  async list(businessId: string) {
    const weekStart = new Date(Date.now() - 7 * 86_400_000);
    const professionals = await this.prisma.professional.findMany({
      where: { businessId },
      select: {
        ...professionalSelect,
        _count: {
          select: {
            appointments: {
              where: { startsAt: { gte: weekStart }, status: { in: ['CONFIRMED', 'COMPLETED'] } },
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    return professionals.map(({ _count, services, ...p }) => ({
      ...p,
      serviceIds: services.map((s) => s.serviceId),
      appointmentsLast7Days: _count.appointments,
    }));
  }

  async create(business: Business, dto: CreateProfessionalDto) {
    this.businesses.assertEditable(business);
    const { serviceIds, ...data } = dto;
    const active = data.active ?? true;
    const created = await this.prisma.$transaction(async (tx) => {
      await this.assertServices(tx, business.id, serviceIds);
      if (active) await this.assertLimit(tx, business.id);
      return tx.professional.create({
        data: {
          ...data,
          active,
          businessId: business.id,
          services: { create: serviceIds.map((serviceId) => ({ serviceId })) },
        },
        select: { id: true },
      });
    });
    return this.getOne(created.id);
  }

  async update(business: Business, id: string, dto: UpdateProfessionalDto) {
    this.businesses.assertEditable(business);
    const current = await this.prisma.professional.findFirst({
      where: { id, businessId: business.id },
    });
    if (!current) throw Errors.notFound('Profissional');
    const { serviceIds, ...data } = dto;
    await this.prisma.$transaction(async (tx) => {
      if (serviceIds) await this.assertServices(tx, business.id, serviceIds);
      if (data.active === true && !current.active) await this.assertLimit(tx, business.id);
      await tx.professional.update({ where: { id }, data });
      if (serviceIds) {
        await tx.professionalService.deleteMany({ where: { professionalId: id } });
        await tx.professionalService.createMany({
          data: serviceIds.map((serviceId) => ({ professionalId: id, serviceId })),
        });
      }
    });
    return this.getOne(id);
  }

  private async getOne(id: string) {
    const { services, ...p } = await this.prisma.professional.findUniqueOrThrow({
      where: { id },
      select: professionalSelect,
    });
    return { ...p, serviceIds: services.map((s) => s.serviceId) };
  }

  /** Serviço vinculado precisa ser do mesmo estabelecimento (Princípio VIII). */
  private async assertServices(
    tx: Prisma.TransactionClient,
    businessId: string,
    ids: string[],
  ): Promise<void> {
    if (!ids.length) return;
    const unique = new Set(ids);
    const count = await tx.service.count({ where: { id: { in: [...unique] }, businessId } });
    if (count !== unique.size) throw Errors.notFound('Serviço');
  }

  /**
   * Trava a linha do estabelecimento antes de contar: duas ativações
   * simultâneas não ultrapassam o limite global (FR-013).
   */
  private async assertLimit(tx: Prisma.TransactionClient, businessId: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM businesses WHERE id = ${businessId} FOR UPDATE`;
    const { maxActiveProfessionals } = await this.settings.get(tx);
    const active = await tx.professional.count({ where: { businessId, active: true } });
    if (active >= maxActiveProfessionals) throw Errors.professionalLimit(maxActiveProfessionals);
  }
}

@ApiTags('Dono · Profissionais')
@Roles('BUSINESS_OWNER')
@UseGuards(OwnerBusinessGuard)
@Controller('owner/professionals')
export class OwnerProfessionalsController {
  constructor(private readonly professionals: ProfessionalsService) {}

  @Get()
  list(@OwnerBusiness() business: Business) {
    return this.professionals.list(business.id);
  }

  @Post()
  create(@OwnerBusiness() business: Business, @Body() dto: CreateProfessionalDto) {
    return this.professionals.create(business, dto);
  }

  @Patch(':id')
  update(
    @OwnerBusiness() business: Business,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProfessionalDto,
  ) {
    return this.professionals.update(business, id, dto);
  }
}

@Module({
  imports: [BusinessesModule],
  controllers: [OwnerProfessionalsController],
  providers: [ProfessionalsService],
})
export class ProfessionalsModule {}
