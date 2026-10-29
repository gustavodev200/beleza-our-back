import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AvailabilityQuery } from '../appointments/appointment.schemas';
import { AvailabilityService } from '../availability/availability.service';
import { Errors } from '../common/errors';
import { skipTake, toPage, type Pagination } from '../common/utils/pagination';
import { normalizeText } from '../common/utils/text';
import { localDateOf, minutesOfDay, weekdayOf } from '../common/utils/time';
import { PrismaService } from '../prisma/prisma.service';
import type { SearchQuery } from './marketplace.schemas';

/**
 * Candidatos avaliados em memória quando o filtro/ordem não cabe no SQL. Rota
 * pública: o teto limita o custo por requisição (security-review.md, SR-2).
 */
const IN_MEMORY_CAP = 100;
const NEW_BADGE_DAYS = 30;

const cardSelect = {
  id: true,
  name: true,
  slug: true,
  type: true,
  neighborhood: true,
  coverUrl: true,
  logoUrl: true,
  ratingAvg: true,
  ratingCount: true,
  minPriceCents: true,
  approvedAt: true,
  latitude: true,
  longitude: true,
  featured: true,
} satisfies Prisma.BusinessSelect;

type CardRow = Prisma.BusinessGetPayload<{ select: typeof cardSelect }>;

export function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = (v: number) => (v * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Somente ACTIVE em cidade ativa existe para o público (FR-040). */
const PUBLIC_WHERE: Prisma.BusinessWhereInput = { status: 'ACTIVE', city: { active: true } };

@Injectable()
export class MarketplaceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly availabilityService: AvailabilityService,
  ) {}

  async findPublicBusiness(slug: string) {
    const business = await this.prisma.business.findFirst({
      where: { slug, ...PUBLIC_WHERE },
      select: { id: true },
    });
    if (!business) throw Errors.notFound('Estabelecimento indisponível');
    return business;
  }

  async availability(slug: string, query: AvailabilityQuery) {
    const business = await this.findPublicBusiness(slug);
    const slots = await this.availabilityService.slots({ businessId: business.id, ...query });
    return { date: query.date, slots };
  }

  /** Busca e filtros (FR-041). */
  async search(q: SearchQuery) {
    if (q.sort === 'distance' && (q.lat === undefined || q.lng === undefined)) {
      throw Errors.unprocessable(
        'LOCATION_REQUIRED',
        'Informe sua localização para ordenar por distância',
      );
    }
    const words = q.q ? normalizeText(q.q).split(' ').filter(Boolean).slice(0, 6) : [];
    const where: Prisma.BusinessWhereInput = {
      ...PUBLIC_WHERE,
      cityId: q.cityId,
      ...(q.categoryId
        ? { categories: { some: { categoryId: q.categoryId, category: { visible: true } } } }
        : {}),
      ...(q.neighborhood ? { neighborhood: { equals: q.neighborhood, mode: 'insensitive' } } : {}),
      ...(words.length ? { AND: words.map((w) => ({ searchText: { contains: w } })) } : {}),
    };

    const orderBy: Prisma.BusinessOrderByWithRelationInput[] =
      q.sort === 'rating'
        ? [{ ratingAvg: 'desc' }, { ratingCount: 'desc' }]
        : q.sort === 'price'
          ? [{ minPriceCents: { sort: 'asc', nulls: 'last' } }]
          : [{ featured: 'desc' }, { ratingAvg: 'desc' }, { ratingCount: 'desc' }, { name: 'asc' }];

    const inMemory = q.sort === 'distance' || q.availableToday;
    if (!inMemory) {
      const [rows, total] = await Promise.all([
        this.prisma.business.findMany({ where, select: cardSelect, orderBy, ...skipTake(q) }),
        this.prisma.business.count({ where }),
      ]);
      return toPage(await this.toCards(rows, q), total, q);
    }

    let rows = await this.prisma.business.findMany({
      where,
      select: cardSelect,
      orderBy,
      take: IN_MEMORY_CAP,
    });
    if (q.availableToday) {
      const flags = await Promise.all(rows.map((r) => this.availabilityService.hasSlotToday(r.id)));
      rows = rows.filter((_, i) => flags[i]);
    }
    if (q.sort === 'distance') {
      rows = rows
        .filter((r) => r.latitude !== null && r.longitude !== null)
        .sort(
          (a, b) =>
            distanceKm(q.lat!, q.lng!, a.latitude!, a.longitude!) -
            distanceKm(q.lat!, q.lng!, b.latitude!, b.longitude!),
        );
    }
    const { skip, take } = skipTake(q);
    return toPage(await this.toCards(rows.slice(skip, skip + take), q), rows.length, q);
  }

  /** "Em destaque" controlado pelo admin, com próximos 3 horários (FR-043). */
  async featured() {
    const rows = await this.prisma.business.findMany({
      where: { ...PUBLIC_WHERE, featured: true },
      select: cardSelect,
      orderBy: [{ ratingAvg: 'desc' }, { name: 'asc' }],
      take: 10,
    });
    return this.toCards(rows, {});
  }

  /** Perfil público por slug (FR-042). */
  async profile(slug: string) {
    const b = await this.prisma.business.findFirst({
      where: { slug, ...PUBLIC_WHERE },
      select: {
        ...cardSelect,
        description: true,
        whatsapp: true,
        phone: true,
        address: true,
        city: { select: { name: true, state: true } },
        categories: {
          where: { category: { visible: true } },
          select: { category: { select: { id: true, name: true, slug: true } } },
        },
        hours: { orderBy: { weekday: 'asc' } },
        services: {
          where: { visible: true, professionals: { some: { professional: { active: true } } } },
          select: {
            id: true,
            name: true,
            durationMinutes: true,
            priceCents: true,
            category: { select: { id: true, name: true } },
            professionals: {
              where: { professional: { active: true } },
              select: { professionalId: true },
            },
          },
          orderBy: { name: 'asc' },
        },
        professionals: {
          where: { active: true },
          select: { id: true, name: true, role: true, photoUrl: true },
        },
      },
    });
    if (!b) throw Errors.notFound('Estabelecimento indisponível');

    const now = new Date();
    const weekday = weekdayOf(localDateOf(now));
    const today = b.hours.find((h) => h.weekday === weekday);
    const minute = minutesOfDay(now);
    const openNow = Boolean(
      today &&
      minute >= today.opensAt &&
      minute < today.closesAt &&
      !(
        today.breakStart !== null &&
        today.breakEnd !== null &&
        minute >= today.breakStart &&
        minute < today.breakEnd
      ),
    );
    const [next] = await this.availabilityService.nextFreeSlots(b.id, 1, now);
    const reviews = await this.reviewsPage(b.id, { page: 1, pageSize: 5 });

    return {
      ...this.baseCard(b),
      description: b.description,
      whatsapp: b.whatsapp,
      phone: b.phone,
      address: b.address,
      city: b.city,
      categories: b.categories.map((c) => c.category),
      hours: b.hours.map(({ weekday: w, opensAt, closesAt, breakStart, breakEnd }) => ({
        weekday: w,
        opensAt,
        closesAt,
        breakStart,
        breakEnd,
      })),
      services: b.services.map(({ professionals, ...s }) => ({
        ...s,
        professionalIds: professionals.map((p) => p.professionalId),
      })),
      professionals: b.professionals,
      openNow,
      closedToday: !today,
      nextSlot: next ?? null,
      latestReviews: reviews.items,
    };
  }

  async reviews(slug: string, p: Pagination) {
    const business = await this.findPublicBusiness(slug);
    return this.reviewsPage(business.id, p);
  }

  /** Só o primeiro nome da cliente aparece publicamente. */
  private async reviewsPage(businessId: string, p: Pagination) {
    const where = { businessId };
    const [rows, total] = await Promise.all([
      this.prisma.review.findMany({
        where,
        select: {
          id: true,
          rating: true,
          tags: true,
          comment: true,
          createdAt: true,
          client: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        ...skipTake(p),
      }),
      this.prisma.review.count({ where }),
    ]);
    return toPage(
      rows.map(({ client, ...r }) => ({ ...r, clientName: client.name.split(' ')[0] })),
      total,
      p,
    );
  }

  private baseCard(r: CardRow, lat?: number, lng?: number) {
    return {
      id: r.id,
      name: r.name,
      slug: r.slug,
      type: r.type,
      neighborhood: r.neighborhood,
      coverUrl: r.coverUrl,
      logoUrl: r.logoUrl,
      ratingAvg: Number(r.ratingAvg),
      ratingCount: r.ratingCount,
      minPriceCents: r.minPriceCents,
      latitude: r.latitude,
      longitude: r.longitude,
      isNew: Boolean(
        r.approvedAt && Date.now() - r.approvedAt.getTime() < NEW_BADGE_DAYS * 86_400_000,
      ),
      isAutonomous: r.type === 'AUTONOMOUS',
      distanceKm:
        lat !== undefined && lng !== undefined && r.latitude !== null && r.longitude !== null
          ? Number(distanceKm(lat, lng, r.latitude, r.longitude).toFixed(1))
          : null,
    };
  }

  private toCards(rows: CardRow[], q: { lat?: number; lng?: number }) {
    return Promise.all(
      rows.map(async (r) => ({
        ...this.baseCard(r, q.lat, q.lng),
        nextSlots: await this.availabilityService.nextFreeSlots(r.id, 3),
      })),
    );
  }
}
