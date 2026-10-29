import { Injectable } from '@nestjs/common';
import type { Business, Prisma } from '@prisma/client';
import { Errors } from '../common/errors';
import { normalizeText, slugify } from '../common/utils/text';

/**
 * O perfil público vive em `/{slug}` no frontend: um slug igual a uma rota
 * estática (sempre em inglês) deixaria o perfil inalcançável.
 */
const RESERVED_SLUGS = new Set([
  'admin',
  'api',
  'appointments',
  'dashboard',
  'explore',
  'favorites',
  'locations',
  'my-schedule',
  'notifications',
  'offline',
  'profile',
  'sign-in',
  'sign-up',
  'welcome',
]);
import { PrismaService } from '../prisma/prisma.service';
import {
  toMinutes,
  type CreateBusinessDto,
  type HoursDto,
  type UpdateBusinessDto,
} from './business.schemas';

const EDITABLE_STATUSES = new Set(['DRAFT', 'PENDING', 'REJECTED', 'ACTIVE']);

export const ownerBusinessInclude = {
  city: { select: { id: true, name: true, state: true } },
  categories: { select: { category: { select: { id: true, name: true, slug: true } } } },
  hours: { orderBy: { weekday: 'asc' } },
} satisfies Prisma.BusinessInclude;

function minutesToHHMM(value: number | null): string | null {
  if (value === null) return null;
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

type BusinessWithRelations = Prisma.BusinessGetPayload<{ include: typeof ownerBusinessInclude }>;

/** Visão do dono: tudo do próprio estabelecimento, sem campos internos (searchText). */
export function toOwnerView(b: BusinessWithRelations) {
  return {
    id: b.id,
    type: b.type,
    name: b.name,
    slug: b.slug,
    description: b.description,
    whatsapp: b.whatsapp,
    phone: b.phone,
    city: b.city,
    neighborhood: b.neighborhood,
    address: b.address,
    latitude: b.latitude,
    longitude: b.longitude,
    coverUrl: b.coverUrl,
    logoUrl: b.logoUrl,
    status: b.status,
    rejectionReason: b.rejectionReason,
    submittedAt: b.submittedAt,
    approvedAt: b.approvedAt,
    requiresConfirmation: b.requiresConfirmation,
    ratingAvg: Number(b.ratingAvg),
    ratingCount: b.ratingCount,
    categories: b.categories.map((c) => c.category),
    hours: b.hours.map((h) => ({
      weekday: h.weekday,
      opensAt: minutesToHHMM(h.opensAt),
      closesAt: minutesToHHMM(h.closesAt),
      breakStart: minutesToHHMM(h.breakStart),
      breakEnd: minutesToHHMM(h.breakEnd),
    })),
  };
}

@Injectable()
export class BusinessesService {
  constructor(private readonly prisma: PrismaService) {}

  async getOwnView(businessId: string) {
    const business = await this.prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      include: ownerBusinessInclude,
    });
    return toOwnerView(business);
  }

  async create(ownerId: string, dto: CreateBusinessDto) {
    if (await this.prisma.business.findUnique({ where: { ownerId }, select: { id: true } })) {
      throw Errors.conflict('BUSINESS_EXISTS', 'Você já possui um estabelecimento');
    }
    await this.assertCityAndCategories(dto.cityId, dto.categoryIds);
    const slug = await this.uniqueSlug(dto.name);
    const { categoryIds, ...data } = dto;
    const business = await this.prisma.business.create({
      data: {
        ...data,
        ownerId,
        slug,
        searchText: normalizeText(`${dto.name} ${dto.neighborhood}`),
        categories: { create: categoryIds.map((categoryId) => ({ categoryId })) },
      },
    });
    await this.refreshDerived(business.id);
    return this.getOwnView(business.id);
  }

  async update(business: Business, dto: UpdateBusinessDto) {
    this.assertEditable(business);
    if (dto.cityId || dto.categoryIds) {
      await this.assertCityAndCategories(dto.cityId ?? business.cityId, dto.categoryIds ?? []);
    }
    const { categoryIds, ...data } = dto;
    await this.prisma.$transaction(async (tx) => {
      await tx.business.update({ where: { id: business.id }, data });
      if (categoryIds) {
        await tx.businessCategory.deleteMany({ where: { businessId: business.id } });
        await tx.businessCategory.createMany({
          data: categoryIds.map((categoryId) => ({ businessId: business.id, categoryId })),
        });
      }
    });
    await this.refreshDerived(business.id);
    return this.getOwnView(business.id);
  }

  async replaceHours(business: Business, dto: HoursDto) {
    this.assertEditable(business);
    await this.prisma.$transaction([
      this.prisma.businessHours.deleteMany({ where: { businessId: business.id } }),
      this.prisma.businessHours.createMany({
        data: dto.days.map((d) => ({
          businessId: business.id,
          weekday: d.weekday,
          opensAt: toMinutes(d.opensAt),
          closesAt: toMinutes(d.closesAt),
          breakStart: d.breakStart ? toMinutes(d.breakStart) : null,
          breakEnd: d.breakEnd ? toMinutes(d.breakEnd) : null,
        })),
      }),
    ]);
    return this.getOwnView(business.id);
  }

  /** DRAFT|REJECTED → PENDING, somente com cadastro completo (FR-016, FR-017). */
  async submit(business: Business, emailVerified: boolean) {
    if (business.status !== 'DRAFT' && business.status !== 'REJECTED')
      throw Errors.invalidTransition();
    const missing: string[] = [];
    if (!emailVerified) missing.push('confirme seu e-mail');
    const [bookableService, hoursCount] = await Promise.all([
      this.prisma.service.findFirst({
        where: {
          businessId: business.id,
          visible: true,
          professionals: { some: { professional: { active: true } } },
        },
        select: { id: true },
      }),
      this.prisma.businessHours.count({ where: { businessId: business.id } }),
    ]);
    if (!bookableService)
      missing.push('cadastre ao menos um serviço visível com uma profissional ativa');
    if (hoursCount === 0) missing.push('defina o horário de funcionamento');
    if (missing.length) throw Errors.businessIncomplete(missing);

    // updateMany com status na condição: dois envios simultâneos não passam juntos.
    const { count } = await this.prisma.business.updateMany({
      where: { id: business.id, status: { in: ['DRAFT', 'REJECTED'] } },
      data: { status: 'PENDING', submittedAt: new Date(), rejectionReason: null },
    });
    if (count === 0) throw Errors.invalidTransition();
    return this.getOwnView(business.id);
  }

  /** Recalcula texto de busca e menor preço a partir dos serviços visíveis. */
  async refreshDerived(
    businessId: string,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    const business = await tx.business.findUniqueOrThrow({
      where: { id: businessId },
      select: {
        name: true,
        neighborhood: true,
        services: { where: { visible: true }, select: { name: true, priceCents: true } },
        categories: { select: { category: { select: { name: true } } } },
      },
    });
    const prices = business.services.map((s) => s.priceCents);
    await tx.business.update({
      where: { id: businessId },
      data: {
        searchText: normalizeText(
          [
            business.name,
            business.neighborhood,
            ...business.services.map((s) => s.name),
            ...business.categories.map((c) => c.category.name),
          ].join(' '),
        ),
        minPriceCents: prices.length ? Math.min(...prices) : null,
      },
    });
  }

  assertEditable(business: Business): void {
    if (!EDITABLE_STATUSES.has(business.status)) {
      throw Errors.forbidden('BUSINESS_SUSPENDED', 'Estabelecimento suspenso: edição indisponível');
    }
  }

  private async assertCityAndCategories(cityId: string, categoryIds: string[]): Promise<void> {
    const [city, categories] = await Promise.all([
      this.prisma.city.findFirst({ where: { id: cityId, active: true }, select: { id: true } }),
      categoryIds.length
        ? this.prisma.category.count({ where: { id: { in: categoryIds } } })
        : Promise.resolve(0),
    ]);
    if (!city) throw Errors.unprocessable('INVALID_CITY', 'Cidade não atendida');
    if (categoryIds.length && categories !== new Set(categoryIds).size) {
      throw Errors.unprocessable('INVALID_CATEGORY', 'Categoria inválida');
    }
  }

  private async uniqueSlug(name: string): Promise<string> {
    const base = slugify(name) || 'estabelecimento';
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
      if (RESERVED_SLUGS.has(candidate)) continue;
      const taken = await this.prisma.business.findUnique({
        where: { slug: candidate },
        select: { id: true },
      });
      if (!taken) return candidate;
    }
    return `${base}-${Date.now().toString(36)}`;
  }
}
