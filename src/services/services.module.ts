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
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Business } from '@prisma/client';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { Roles } from '../auth/decorators';
import { BusinessesModule } from '../businesses/businesses.module';
import { BusinessesService } from '../businesses/businesses.service';
import { OwnerBusiness, OwnerBusinessGuard } from '../businesses/owner-business.guard';
import { Errors } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';

const serviceFields = {
  name: z.string().trim().min(2).max(80),
  categoryId: z.string().uuid(),
  durationMinutes: z.number().int().min(5).max(480).multipleOf(5),
  priceCents: z.number().int().min(0).max(10_000_000),
  visible: z.boolean().optional(),
  /** Quem faz o serviço. Sem profissional o serviço não aparece para as clientes. */
  professionalIds: z.array(z.string().uuid()).max(100).optional(),
};
const createServiceSchema = z.object(serviceFields).strict();
const updateServiceSchema = z
  .object(serviceFields)
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Nada para atualizar');
class CreateServiceDto extends createZodDto(createServiceSchema) {}
class UpdateServiceDto extends createZodDto(updateServiceSchema) {}

const serviceSelect = {
  id: true,
  name: true,
  durationMinutes: true,
  priceCents: true,
  visible: true,
  category: { select: { id: true, name: true } },
  professionals: { select: { professionalId: true } },
} as const;

@Injectable()
export class ServicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly businesses: BusinessesService,
  ) {}

  list(businessId: string) {
    return this.prisma.service.findMany({
      where: { businessId },
      select: serviceSelect,
      orderBy: { name: 'asc' },
    });
  }

  async create(business: Business, dto: CreateServiceDto) {
    this.businesses.assertEditable(business);
    await this.assertCategory(dto.categoryId);
    const { professionalIds, ...data } = dto;
    // Sem escolha explícita, todas as profissionais ativas fazem o serviço novo.
    const ids = professionalIds
      ? await this.assertProfessionals(business.id, professionalIds)
      : (
          await this.prisma.professional.findMany({
            where: { businessId: business.id, active: true },
            select: { id: true },
          })
        ).map((p) => p.id);
    const service = await this.prisma.service.create({
      data: {
        ...data,
        businessId: business.id,
        professionals: { create: ids.map((professionalId) => ({ professionalId })) },
      },
      select: serviceSelect,
    });
    await this.businesses.refreshDerived(business.id);
    return service;
  }

  async update(business: Business, id: string, dto: UpdateServiceDto) {
    this.businesses.assertEditable(business);
    await this.findOwned(business.id, id);
    if (dto.categoryId) await this.assertCategory(dto.categoryId);
    const { professionalIds, ...data } = dto;
    const ids = professionalIds && (await this.assertProfessionals(business.id, professionalIds));
    const service = await this.prisma.service.update({
      where: { id },
      data: {
        ...data,
        ...(ids && {
          professionals: {
            deleteMany: {},
            create: ids.map((professionalId) => ({ professionalId })),
          },
        }),
      },
      select: serviceSelect,
    });
    await this.businesses.refreshDerived(business.id);
    return service;
  }

  /** Exclusão só sem histórico; com agendamentos, o dono deve ocultar (FR-012). */
  async remove(business: Business, id: string): Promise<void> {
    this.businesses.assertEditable(business);
    await this.findOwned(business.id, id);
    const used = await this.prisma.appointment.count({ where: { serviceId: id } });
    if (used > 0) {
      throw Errors.conflict('SERVICE_IN_USE', 'Serviço com agendamentos: oculte em vez de excluir');
    }
    await this.prisma.service.delete({ where: { id } });
    await this.businesses.refreshDerived(business.id);
  }

  /** Filtra por estabelecimento: ID de outro dono responde 404 (Princípio VIII). */
  private async findOwned(businessId: string, id: string) {
    const service = await this.prisma.service.findFirst({
      where: { id, businessId },
      select: { id: true },
    });
    if (!service) throw Errors.notFound('Serviço');
    return service;
  }

  /** IDs de outro estabelecimento respondem 422 (Princípio VIII). */
  private async assertProfessionals(businessId: string, ids: string[]): Promise<string[]> {
    const unique = [...new Set(ids)];
    const count = await this.prisma.professional.count({
      where: { businessId, id: { in: unique } },
    });
    if (count !== unique.length)
      throw Errors.unprocessable('INVALID_PROFESSIONAL', 'Profissional inválida');
    return unique;
  }

  private async assertCategory(categoryId: string): Promise<void> {
    const exists = await this.prisma.category.findUnique({
      where: { id: categoryId },
      select: { id: true },
    });
    if (!exists) throw Errors.unprocessable('INVALID_CATEGORY', 'Categoria inválida');
  }
}

@ApiTags('Dono · Serviços')
@Roles('BUSINESS_OWNER')
@UseGuards(OwnerBusinessGuard)
@Controller('owner/services')
export class OwnerServicesController {
  constructor(private readonly services: ServicesService) {}

  @Get()
  list(@OwnerBusiness() business: Business) {
    return this.services.list(business.id);
  }

  @Post()
  create(@OwnerBusiness() business: Business, @Body() dto: CreateServiceDto) {
    return this.services.create(business, dto);
  }

  @Patch(':id')
  update(
    @OwnerBusiness() business: Business,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceDto,
  ) {
    return this.services.update(business, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@OwnerBusiness() business: Business, @Param('id', ParseUUIDPipe) id: string) {
    return this.services.remove(business, id);
  }
}

@Module({
  imports: [BusinessesModule],
  controllers: [OwnerServicesController],
  providers: [ServicesService],
})
export class ServicesModule {}
