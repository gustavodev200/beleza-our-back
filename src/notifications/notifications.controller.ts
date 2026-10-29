import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { CurrentUser, type AuthUser } from '../auth/decorators';
import { paginationSchema, skipTake, toPage } from '../common/utils/pagination';
import { PrismaService } from '../prisma/prisma.service';

class NotificationsQuery extends createZodDto(paginationSchema.strict()) {}
const readSchema = z.object({ ids: z.array(z.string().uuid()).max(100).optional() }).strict();
class ReadDto extends createZodDto(readSchema) {}

@ApiTags('Notificações')
@Controller('me/notifications')
export class NotificationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser, @Query() q: NotificationsQuery) {
    const where = { userId: user.id };
    const [items, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        select: {
          id: true,
          type: true,
          title: true,
          body: true,
          data: true,
          readAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        ...skipTake(q),
      }),
      this.prisma.notification.count({ where }),
    ]);
    return toPage(items, total, q);
  }

  @Get('unread-count')
  async unread(@CurrentUser() user: AuthUser) {
    return {
      count: await this.prisma.notification.count({ where: { userId: user.id, readAt: null } }),
    };
  }

  /** Marca como lidas (todas, ou só os ids informados) — sempre filtrado pelo dono. */
  @Post('read')
  @HttpCode(200)
  async read(@CurrentUser() user: AuthUser, @Body() dto: ReadDto) {
    const { count } = await this.prisma.notification.updateMany({
      where: { userId: user.id, readAt: null, ...(dto.ids ? { id: { in: dto.ids } } : {}) },
      data: { readAt: new Date() },
    });
    return { updated: count };
  }
}
