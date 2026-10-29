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
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Prisma, type Role } from '@prisma/client';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { AuditService, toJson } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { PHONE_EMAIL_DOMAIN } from '../auth/better-auth';
import { CurrentUser, Roles, type AuthUser } from '../auth/decorators';
import { Errors } from '../common/errors';
import { paginationSchema, skipTake, toPage } from '../common/utils/pagination';
import { slugify } from '../common/utils/text';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

/** E-mail técnico de quem entrou por telefone não é dado real: não exibimos. */
export const publicEmail = (email: string) =>
  email.endsWith(`@${PHONE_EMAIL_DOMAIN}`) ? null : email;

// ------------------------------------------------------------ configurações --

const settingsSchema = z
  .object({
    cancellationWindowMinutes: z.union([
      z.literal(60),
      z.literal(120),
      z.literal(360),
      z.literal(1440),
    ]),
    remindersEnabled: z.boolean(),
    reviewRequestEnabled: z.boolean(),
    maxActiveProfessionals: z.number().int().min(1).max(50),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Nada para atualizar');
class UpdateSettingsDto extends createZodDto(settingsSchema) {}

// ------------------------------------------------------------------ usuários --

const usersQuerySchema = paginationSchema
  .extend({
    role: z.enum(['CLIENT', 'BUSINESS_OWNER', 'SUPER_ADMIN']).optional(),
    q: z.string().trim().max(80).optional(),
  })
  .strict();
class UsersQuery extends createZodDto(usersQuerySchema) {}

const blockSchema = z.object({ reason: z.string().trim().max(300).optional() }).strict();
class BlockDto extends createZodDto(blockSchema) {}

// ----------------------------------------------------------------- catálogo --

const categorySchema = z
  .object({
    name: z.string().trim().min(2).max(40),
    icon: z
      .string()
      .trim()
      .regex(/^[a-z0-9_]{2,40}$/, 'Nome de ícone Material Symbols'),
    visible: z.boolean().optional(),
  })
  .strict();
class CreateCategoryDto extends createZodDto(categorySchema) {}
class UpdateCategoryDto extends createZodDto(
  categorySchema.partial().refine((v) => Object.keys(v).length > 0, 'Nada para atualizar'),
) {}
const orderSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(100) }).strict();
class OrderDto extends createZodDto(orderSchema) {}

const citySchema = z
  .object({
    name: z.string().trim().min(2).max(60),
    state: z.string().trim().length(2).toUpperCase(),
    active: z.boolean().optional(),
  })
  .strict();
class CreateCityDto extends createZodDto(citySchema) {}
const updateCitySchema = z.object({ active: z.boolean() }).strict();
class UpdateCityDto extends createZodDto(updateCitySchema) {}

class AuditQuery extends createZodDto(
  paginationSchema.extend({ targetId: z.string().max(64).optional() }).strict(),
) {}

@Injectable()
export class AdminPlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly authService: AuthService,
  ) {}

  async getSettings() {
    const s = await this.settings.get();
    // Aprovação obrigatória é regra fixa do produto, não configurável (FR-064).
    return { ...s, approvalRequired: true };
  }

  async updateSettings(dto: UpdateSettingsDto, actor: AuthUser, ip: string) {
    const before = await this.settings.get();
    const after = await this.settings.update(dto);
    await this.audit.record({
      actorId: actor.id,
      action: 'SETTINGS_UPDATED',
      targetType: 'settings',
      targetId: 'global',
      ip,
      summary: toJson({ before, changes: dto }),
    });
    return { ...after, approvalRequired: true };
  }

  async users(q: UsersQuery) {
    const where: Prisma.UserWhereInput = {
      role: q.role,
      anonymizedAt: null,
      ...(q.q
        ? {
            OR: [
              { name: { contains: q.q, mode: 'insensitive' } },
              { email: { contains: q.q, mode: 'insensitive' } },
              { phoneNumber: { contains: q.q.replace(/\D/g, '') || q.q } },
            ],
          }
        : {}),
    };
    const [items, total, byRole] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          email: true,
          phoneNumber: true,
          role: true,
          banned: true,
          banReason: true,
          createdAt: true,
          business: { select: { id: true, name: true, status: true } },
        },
        orderBy: { createdAt: 'desc' },
        ...skipTake(q),
      }),
      this.prisma.user.count({ where }),
      this.prisma.user.groupBy({
        by: ['role'],
        where: { anonymizedAt: null },
        _count: { _all: true },
      }),
    ]);
    const counts = Object.fromEntries(byRole.map((r) => [r.role, r._count._all])) as Partial<
      Record<Role, number>
    >;
    return {
      ...toPage(
        items.map((u) => ({ ...u, email: publicEmail(u.email) })),
        total,
        q,
      ),
      counts: {
        all: Object.values(counts).reduce((a, b) => a + (b ?? 0), 0),
        CLIENT: counts.CLIENT ?? 0,
        BUSINESS_OWNER: counts.BUSINESS_OWNER ?? 0,
        SUPER_ADMIN: counts.SUPER_ADMIN ?? 0,
      },
    };
  }

  /** Bloquear encerra todas as sessões; admins não podem ser bloqueados (FR-062). */
  async setBlocked(
    id: string,
    blocked: boolean,
    reason: string | undefined,
    actor: AuthUser,
    ip: string,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { role: true, banned: true },
    });
    if (!user) throw Errors.notFound('Usuário');
    if (user.role === 'SUPER_ADMIN')
      throw Errors.forbidden('CANNOT_BLOCK_ADMIN', 'Administradores não podem ser bloqueados');
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: { banned: blocked, banReason: blocked ? (reason ?? null) : null },
      });
      if (blocked) await tx.session.deleteMany({ where: { userId: id } });
      await this.audit.record(
        {
          actorId: actor.id,
          action: blocked ? 'USER_BLOCKED' : 'USER_UNBLOCKED',
          targetType: 'user',
          targetId: id,
          ip,
          summary: { reason: reason ?? null },
        },
        tx,
      );
    });
    return { id, banned: blocked };
  }

  async categories() {
    const weekAgo = new Date(Date.now() - 7 * 86_400_000);
    const categories = await this.prisma.category.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        slug: true,
        icon: true,
        visible: true,
        sortOrder: true,
        _count: { select: { businesses: { where: { business: { status: 'ACTIVE' } } } } },
        services: {
          select: {
            _count: {
              select: {
                appointments: {
                  where: { startsAt: { gte: weekAgo }, status: { not: 'CANCELED' } },
                },
              },
            },
          },
        },
      },
    });
    return categories.map(({ _count, services, ...c }) => ({
      ...c,
      activeBusinesses: _count.businesses,
      appointmentsLast7Days: services.reduce((sum, s) => sum + s._count.appointments, 0),
    }));
  }

  async createCategory(dto: CreateCategoryDto, actor: AuthUser, ip: string) {
    const last = await this.prisma.category.aggregate({ _max: { sortOrder: true } });
    const category = await this.prisma.category.create({
      data: { ...dto, slug: slugify(dto.name), sortOrder: (last._max.sortOrder ?? -1) + 1 },
    });
    await this.audit.record({
      actorId: actor.id,
      action: 'CATEGORY_CREATED',
      targetType: 'category',
      targetId: category.id,
      ip,
      summary: toJson(dto),
    });
    return category;
  }

  async updateCategory(id: string, dto: UpdateCategoryDto, actor: AuthUser, ip: string) {
    if (!(await this.prisma.category.findUnique({ where: { id }, select: { id: true } })))
      throw Errors.notFound('Categoria');
    const category = await this.prisma.category.update({
      where: { id },
      data: { ...dto, ...(dto.name ? { slug: slugify(dto.name) } : {}) },
    });
    await this.audit.record({
      actorId: actor.id,
      action: 'CATEGORY_UPDATED',
      targetType: 'category',
      targetId: id,
      ip,
      summary: toJson(dto),
    });
    return category;
  }

  async reorderCategories(ids: string[], actor: AuthUser, ip: string) {
    const unique = [...new Set(ids)];
    const count = await this.prisma.category.count({ where: { id: { in: unique } } });
    if (count !== unique.length) throw Errors.notFound('Categoria');
    await this.prisma.$transaction(
      unique.map((id, index) =>
        this.prisma.category.update({ where: { id }, data: { sortOrder: index } }),
      ),
    );
    await this.audit.record({
      actorId: actor.id,
      action: 'CATEGORIES_REORDERED',
      targetType: 'category',
      ip,
      summary: { ids: unique },
    });
    return this.categories();
  }

  cities() {
    return this.prisma.city.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        state: true,
        slug: true,
        active: true,
        _count: { select: { businesses: true } },
      },
    });
  }

  async createCity(dto: CreateCityDto, actor: AuthUser, ip: string) {
    const city = await this.prisma.city.create({
      data: { ...dto, slug: slugify(`${dto.name}-${dto.state}`) },
    });
    await this.audit.record({
      actorId: actor.id,
      action: 'CITY_CREATED',
      targetType: 'city',
      targetId: city.id,
      ip,
      summary: toJson(dto),
    });
    return city;
  }

  async updateCity(id: string, dto: UpdateCityDto, actor: AuthUser, ip: string) {
    if (!(await this.prisma.city.findUnique({ where: { id }, select: { id: true } })))
      throw Errors.notFound('Cidade');
    const city = await this.prisma.city.update({ where: { id }, data: dto });
    await this.audit.record({
      actorId: actor.id,
      action: 'CITY_UPDATED',
      targetType: 'city',
      targetId: id,
      ip,
      summary: toJson(dto),
    });
    return city;
  }

  async auditLogs(q: AuditQuery) {
    const where: Prisma.AuditLogWhereInput = q.targetId ? { targetId: q.targetId } : {};
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: { actor: { select: { id: true, name: true, email: true } } },
        ...skipTake(q),
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return toPage(items, total, q);
  }
}

@ApiTags('Admin · Plataforma')
@Roles('SUPER_ADMIN')
@Controller('admin')
export class AdminPlatformController {
  constructor(private readonly service: AdminPlatformService) {}

  @Get('settings')
  getSettings() {
    return this.service.getSettings();
  }

  @Patch('settings')
  updateSettings(@Body() dto: UpdateSettingsDto, @CurrentUser() actor: AuthUser, @Ip() ip: string) {
    return this.service.updateSettings(dto, actor, ip);
  }

  @Get('users')
  users(@Query() q: UsersQuery) {
    return this.service.users(q);
  }

  @Post('users/:id/block')
  @HttpCode(200)
  block(
    @Param('id') id: string,
    @Body() dto: BlockDto,
    @CurrentUser() actor: AuthUser,
    @Ip() ip: string,
  ) {
    return this.service.setBlocked(id, true, dto.reason, actor, ip);
  }

  @Post('users/:id/unblock')
  @HttpCode(200)
  unblock(@Param('id') id: string, @CurrentUser() actor: AuthUser, @Ip() ip: string) {
    return this.service.setBlocked(id, false, undefined, actor, ip);
  }

  @Get('categories')
  categories() {
    return this.service.categories();
  }

  @Post('categories')
  createCategory(@Body() dto: CreateCategoryDto, @CurrentUser() actor: AuthUser, @Ip() ip: string) {
    return this.service.createCategory(dto, actor, ip);
  }

  @Put('categories/order')
  reorder(@Body() dto: OrderDto, @CurrentUser() actor: AuthUser, @Ip() ip: string) {
    return this.service.reorderCategories(dto.ids, actor, ip);
  }

  @Patch('categories/:id')
  updateCategory(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
    @CurrentUser() actor: AuthUser,
    @Ip() ip: string,
  ) {
    return this.service.updateCategory(id, dto, actor, ip);
  }

  @Get('cities')
  cities() {
    return this.service.cities();
  }

  @Post('cities')
  createCity(@Body() dto: CreateCityDto, @CurrentUser() actor: AuthUser, @Ip() ip: string) {
    return this.service.createCity(dto, actor, ip);
  }

  @Patch('cities/:id')
  updateCity(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCityDto,
    @CurrentUser() actor: AuthUser,
    @Ip() ip: string,
  ) {
    return this.service.updateCity(id, dto, actor, ip);
  }

  @Get('audit-logs')
  auditLogs(@Query() q: AuditQuery) {
    return this.service.auditLogs(q);
  }
}
