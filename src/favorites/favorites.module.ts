import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Module,
  Param,
  ParseUUIDPipe,
  Put,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles, type AuthUser } from '../auth/decorators';
import { Errors } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('Cliente · Favoritos')
@Roles('CLIENT')
@Controller('me/favorites')
export class FavoritesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    const favorites = await this.prisma.favorite.findMany({
      where: { clientId: user.id, business: { status: 'ACTIVE', city: { active: true } } },
      select: {
        createdAt: true,
        business: {
          select: {
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
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return favorites.map((f) => ({
      ...f.business,
      ratingAvg: Number(f.business.ratingAvg),
      favoritedAt: f.createdAt,
    }));
  }

  /** Idempotente: favoritar duas vezes não duplica. */
  @Put(':businessId')
  @HttpCode(204)
  async add(
    @CurrentUser() user: AuthUser,
    @Param('businessId', ParseUUIDPipe) businessId: string,
  ): Promise<void> {
    const business = await this.prisma.business.findFirst({
      where: { id: businessId, status: 'ACTIVE', city: { active: true } },
      select: { id: true },
    });
    if (!business) throw Errors.notFound('Estabelecimento');
    await this.prisma.favorite.upsert({
      where: { clientId_businessId: { clientId: user.id, businessId } },
      create: { clientId: user.id, businessId },
      update: {},
    });
  }

  @Delete(':businessId')
  @HttpCode(204)
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('businessId', ParseUUIDPipe) businessId: string,
  ): Promise<void> {
    await this.prisma.favorite.deleteMany({ where: { clientId: user.id, businessId } });
  }
}

@Module({ controllers: [FavoritesController] })
export class FavoritesModule {}
