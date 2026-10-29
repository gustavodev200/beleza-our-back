import { Controller, Get, Injectable, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Prisma } from '@prisma/client';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { Roles } from '../auth/decorators';
import { Errors } from '../common/errors';
import { addDaysToDate, DATE_REGEX, dayBounds, localDateOf } from '../common/utils/time';
import { PrismaService } from '../prisma/prisma.service';

const dashboardSchema = z
  .object({
    cityId: z.string().uuid().optional(),
    from: z.string().regex(DATE_REGEX).optional(),
    to: z.string().regex(DATE_REGEX).optional(),
  })
  .strict();
class DashboardQuery extends createZodDto(dashboardSchema) {}

@Injectable()
export class AdminDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /** KPIs por cidade e período (FR-065). Padrão: últimos 7 dias, incluindo hoje. */
  async dashboard(q: DashboardQuery) {
    const today = localDateOf(new Date());
    const to = q.to ?? today;
    const from = q.from ?? addDaysToDate(to, -6);
    if (from > to || addDaysToDate(from, 366) < to) {
      throw Errors.unprocessable('INVALID_RANGE', 'Período inválido (máximo 1 ano)');
    }
    const range = { gte: dayBounds(from).start, lt: dayBounds(to).end };
    const businessScope: Prisma.BusinessWhereInput = q.cityId ? { cityId: q.cityId } : {};
    const inPeriod: Prisma.AppointmentWhereInput = { startsAt: range, business: businessScope };

    const [activeBusinesses, pendingApprovals, clients, appointments, queue] = await Promise.all([
      this.prisma.business.count({ where: { ...businessScope, status: 'ACTIVE' } }),
      this.prisma.business.count({ where: { ...businessScope, status: 'PENDING' } }),
      this.prisma.user.count({ where: { role: 'CLIENT', anonymizedAt: null } }),
      this.prisma.appointment.findMany({
        where: inPeriod,
        select: {
          startsAt: true,
          status: true,
          priceCents: true,
          businessId: true,
          business: { select: { name: true, slug: true } },
          service: { select: { category: { select: { id: true, name: true } } } },
        },
      }),
      this.prisma.business.findMany({
        where: { ...businessScope, status: 'PENDING' },
        select: { id: true, name: true, type: true, neighborhood: true, submittedAt: true },
        orderBy: { submittedAt: 'asc' },
        take: 5,
      }),
    ]);

    const booked = appointments.filter((a) => a.status !== 'CANCELED');
    const attended = appointments.filter((a) => a.status === 'COMPLETED').length;
    const noShows = appointments.filter((a) => a.status === 'NO_SHOW').length;

    const byDay = new Map<string, number>();
    for (let d = from; d <= to; d = addDaysToDate(d, 1)) byDay.set(d, 0);
    const byCategory = new Map<string, { id: string; name: string; count: number }>();
    const byBusiness = new Map<string, { id: string; name: string; slug: string; count: number }>();
    for (const a of booked) {
      const day = localDateOf(a.startsAt);
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
      const cat = a.service.category;
      byCategory.set(cat.id, { ...cat, count: (byCategory.get(cat.id)?.count ?? 0) + 1 });
      byBusiness.set(a.businessId, {
        id: a.businessId,
        ...a.business,
        count: (byBusiness.get(a.businessId)?.count ?? 0) + 1,
      });
    }

    return {
      period: { from, to, today },
      kpis: {
        activeBusinesses,
        pendingApprovals,
        appointments: booked.length,
        bookedVolumeCents: booked.reduce((sum, a) => sum + a.priceCents, 0),
        clients,
        noShowRate: attended + noShows ? Number((noShows / (attended + noShows)).toFixed(4)) : 0,
      },
      appointmentsByDay: [...byDay].map(([date, count]) => ({ date, count })),
      appointmentsByCategory: [...byCategory.values()].sort((a, b) => b.count - a.count),
      topBusinesses: [...byBusiness.values()].sort((a, b) => b.count - a.count).slice(0, 5),
      approvalQueue: queue,
    };
  }
}

@ApiTags('Admin · Dashboard')
@Roles('SUPER_ADMIN')
@Controller('admin/dashboard')
export class AdminDashboardController {
  constructor(private readonly service: AdminDashboardService) {}

  @Get()
  get(@Query() q: DashboardQuery) {
    return this.service.dashboard(q);
  }
}
