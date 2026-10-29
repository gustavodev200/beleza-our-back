import { Controller, Get, Module } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('Catálogo')
@Public()
@Controller()
export class CatalogController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('cities')
  cities() {
    return this.prisma.city.findMany({
      where: { active: true },
      select: { id: true, name: true, state: true, slug: true },
      orderBy: { name: 'asc' },
    });
  }

  @Get('categories')
  categories() {
    return this.prisma.category.findMany({
      where: { visible: true },
      select: { id: true, name: true, slug: true, icon: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }
}

@Module({ controllers: [CatalogController] })
export class CatalogModule {}
