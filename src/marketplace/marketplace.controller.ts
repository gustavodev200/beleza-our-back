import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/decorators';
import { loadEnv } from '../config/env';
import { AvailabilityQuery } from '../appointments/appointment.schemas';
import { ReviewsQueryDto, SearchQueryDto } from './marketplace.schemas';
import { MarketplaceService } from './marketplace.service';

@ApiTags('Marketplace (público)')
@Public()
@Controller('businesses')
export class MarketplaceController {
  constructor(private readonly marketplace: MarketplaceService) {}

  @Get()
  @Throttle({ default: { limit: loadEnv().NODE_ENV === 'test' ? 100_000 : 60, ttl: 60_000 } })
  search(@Query() query: SearchQueryDto) {
    return this.marketplace.search(query);
  }

  @Get('featured')
  featured() {
    return this.marketplace.featured();
  }

  @Get(':slug')
  profile(@Param('slug') slug: string) {
    return this.marketplace.profile(slug);
  }

  @Get(':slug/reviews')
  reviews(@Param('slug') slug: string, @Query() query: ReviewsQueryDto) {
    return this.marketplace.reviews(slug, query);
  }

  @Get(':slug/availability')
  availability(@Param('slug') slug: string, @Query() query: AvailabilityQuery) {
    return this.marketplace.availability(slug, query);
  }
}
