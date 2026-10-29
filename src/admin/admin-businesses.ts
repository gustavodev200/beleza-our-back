import {
  Body,
  Controller,
  Get,
  HttpCode,
  Injectable,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { BusinessStatus, Prisma } from '@prisma/client';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { OwnerAgendaService } from '../appointments/owner-agenda.service';
import { AuditService } from '../audit/audit.service';
import { DATE_REGEX } from '../common/utils/time';
import { CurrentUser, Roles, type AuthUser } from '../auth/decorators';
import { Errors } from '../common/errors';
import { paginationSchema, skipTake, toPage } from '../common/utils/pagination';
import { normalizeText } from '../common/utils/text';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

const listSchema = paginationSchema
  .extend({
    status: z.enum(['DRAFT', 'PENDING', 'ACTIVE', 'REJECTED', 'SUSPENDED']).optional(),
    cityId: z.string().uuid().optional(),
    q: z.string().trim().max(80).optional(),
  })
  .strict();
class ListBusinessesQuery extends createZodDto(listSchema) {}

const rejectSchema = z.object({ reason: z.string().trim().min(5).max(500) }).strict();
class RejectDto extends createZodDto(rejectSchema) {}

const adminAgendaSchema = z
  .object({ from: z.string().regex(DATE_REGEX), to: z.string().regex(DATE_REGEX) })
  .strict();
class AdminAgendaQuery extends createZodDto(adminAgendaSchema) {}

const featuredSchema = z.object({ featured: z.boolean() }).strict();
class FeaturedDto extends createZodDto(featuredSchema) {}

@Injectable()
export class AdminBusinessesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(query: ListBusinessesQuery) {
    const where: Prisma.BusinessWhereInput = {
      status: query.status,
      cityId: query.cityId,
      ...(query.q ? { searchText: { contains: normalizeText(query.q) } } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.business.findMany({
        where,
        select: {
          id: true,
          name: true,
          slug: true,
          type: true,
          neighborhood: true,
          status: true,
          featured: true,
          ratingAvg: true,
          ratingCount: true,
          submittedAt: true,
          createdAt: true,
          owner: { select: { id: true, name: true, email: true } },
        },
        // Fila de aprovação: mais antigos primeiro.
        orderBy: query.status === 'PENDING' ? { submittedAt: 'asc' } : { createdAt: 'desc' },
        ...skipTake(query),
      }),
      this.prisma.business.count({ where }),
    ]);
    return toPage(
      items.map((b) => ({ ...b, ratingAvg: Number(b.ratingAvg) })),
      total,
      query,
    );
  }

  async detail(id: string) {
    const b = await this.prisma.business.findUnique({
      where: { id },
      include: {
        owner: {
          select: { id: true, name: true, email: true, emailVerified: true, createdAt: true },
        },
        city: { select: { name: true, state: true } },
        categories: { select: { category: { select: { id: true, name: true } } } },
        hours: { orderBy: { weekday: 'asc' } },
        services: {
          select: { id: true, name: true, durationMinutes: true, priceCents: true, visible: true },
        },
        professionals: { select: { id: true, name: true, role: true, active: true } },
      },
    });
    if (!b) throw Errors.notFound('Estabelecimento');
    const { categories, ...rest } = b;
    delete (rest as { searchText?: string }).searchText;
    return {
      ...rest,
      ratingAvg: Number(b.ratingAvg),
      categories: categories.map((c) => c.category),
    };
  }

  async approve(id: string, actor: AuthUser, ip: string) {
    await this.transition(
      id,
      ['PENDING'],
      'ACTIVE',
      { approvedAt: new Date(), rejectionReason: null },
      'BUSINESS_APPROVED',
      actor,
      ip,
    );
    await this.notifications.businessDecision(id, true);
    return this.detail(id);
  }

  async reject(id: string, reason: string, actor: AuthUser, ip: string) {
    await this.transition(
      id,
      ['PENDING'],
      'REJECTED',
      { rejectionReason: reason },
      'BUSINESS_REJECTED',
      actor,
      ip,
      { reason },
    );
    await this.notifications.businessDecision(id, false, reason);
    return this.detail(id);
  }

  async suspend(id: string, actor: AuthUser, ip: string) {
    await this.transition(
      id,
      ['ACTIVE'],
      'SUSPENDED',
      { featured: false },
      'BUSINESS_SUSPENDED',
      actor,
      ip,
    );
    await this.notifications.businessSuspended(id);
    return this.detail(id);
  }

  async reactivate(id: string, actor: AuthUser, ip: string) {
    await this.transition(id, ['SUSPENDED'], 'ACTIVE', {}, 'BUSINESS_REACTIVATED', actor, ip);
    return this.detail(id);
  }

  async setFeatured(id: string, featured: boolean, actor: AuthUser, ip: string) {
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.business.updateMany({
        where: { id, ...(featured ? { status: 'ACTIVE' } : {}) },
        data: { featured },
      });
      if (count === 0) {
        if (!(await tx.business.findUnique({ where: { id }, select: { id: true } })))
          throw Errors.notFound('Estabelecimento');
        throw Errors.unprocessable(
          'BUSINESS_NOT_ACTIVE',
          'Só estabelecimentos ativos podem ser destacados',
        );
      }
      await this.audit.record(
        {
          actorId: actor.id,
          action: featured ? 'BUSINESS_FEATURED' : 'BUSINESS_UNFEATURED',
          targetType: 'business',
          targetId: id,
          ip,
        },
        tx,
      );
    });
    return this.detail(id);
  }

  /** Transição condicionada ao status atual + auditoria na mesma transação (FR-017, FR-067). */
  private async transition(
    id: string,
    from: BusinessStatus[],
    to: BusinessStatus,
    data: Prisma.BusinessUpdateManyMutationInput,
    action: string,
    actor: AuthUser,
    ip: string,
    extra: Prisma.InputJsonObject = {},
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.business.findUnique({ where: { id }, select: { status: true } });
      if (!current) throw Errors.notFound('Estabelecimento');
      const { count } = await tx.business.updateMany({
        where: { id, status: { in: from } },
        data: { ...data, status: to },
      });
      if (count === 0) throw Errors.invalidTransition();
      await this.audit.record(
        {
          actorId: actor.id,
          action,
          targetType: 'business',
          targetId: id,
          ip,
          summary: { from: current.status, to, ...extra },
        },
        tx,
      );
    });
  }
}

@ApiTags('Admin · Estabelecimentos')
@Roles('SUPER_ADMIN')
@Controller('admin/businesses')
export class AdminBusinessesController {
  constructor(
    private readonly service: AdminBusinessesService,
    private readonly agendaService: OwnerAgendaService,
  ) {}

  @Get()
  list(@Query() query: ListBusinessesQuery) {
    return this.service.list(query);
  }

  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.detail(id);
  }

  @Post(':id/approve')
  @HttpCode(200)
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthUser,
    @Ip() ip: string,
  ) {
    return this.service.approve(id, actor, ip);
  }

  @Post(':id/reject')
  @HttpCode(200)
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectDto,
    @CurrentUser() actor: AuthUser,
    @Ip() ip: string,
  ) {
    return this.service.reject(id, dto.reason, actor, ip);
  }

  @Post(':id/suspend')
  @HttpCode(200)
  suspend(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthUser,
    @Ip() ip: string,
  ) {
    return this.service.suspend(id, actor, ip);
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  reactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthUser,
    @Ip() ip: string,
  ) {
    return this.service.reactivate(id, actor, ip);
  }

  /** Leitura da agenda de qualquer estabelecimento (FR-066). */
  @Get(':id/agenda')
  async agenda(@Param('id', ParseUUIDPipe) id: string, @Query() query: AdminAgendaQuery) {
    await this.service.detail(id);
    return this.agendaService.agenda(id, query.from, query.to);
  }

  @Patch(':id/featured')
  featured(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FeaturedDto,
    @CurrentUser() actor: AuthUser,
    @Ip() ip: string,
  ) {
    return this.service.setFeatured(id, dto.featured, actor, ip);
  }
}
