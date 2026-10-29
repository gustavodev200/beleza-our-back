import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ZodValidationPipe } from 'nestjs-zod';
import { AdminModule } from './admin/admin.module';
import { AppointmentsModule } from './appointments/appointments.module';
import { AuditModule } from './audit/audit.service';
import { AuthGuard } from './auth/auth.guard';
import { AuthModule } from './auth/auth.module';
import { AvailabilityModule } from './availability/availability.module';
import { RolesGuard } from './auth/roles.guard';
import { BlocksModule } from './blocks/blocks.module';
import { BusinessesModule } from './businesses/businesses.module';
import { CatalogModule } from './catalog/catalog.controller';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { loadEnv } from './config/env';
import { FavoritesModule } from './favorites/favorites.module';
import { HealthController } from './health/health.controller';
import { IntegrationsModule } from './integrations/integrations.module';
import { MeModule } from './me/me.module';
import { MarketplaceModule } from './marketplace/marketplace.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProfessionalsModule } from './professionals/professionals.module';
import { ServicesModule } from './services/services.module';
import { ReviewsModule } from './reviews/reviews.module';
import { SettingsModule } from './settings/settings.service';

const env = loadEnv();

@Module({
  imports: [
    ThrottlerModule.forRoot([
      // Testes e2e saem todos do mesmo IP; o limite real é validado em dev/prod.
      { name: 'default', ttl: 60_000, limit: env.NODE_ENV === 'test' ? 100_000 : 120 },
    ]),
    ScheduleModule.forRoot(),
    PrismaModule,
    IntegrationsModule,
    AuditModule,
    SettingsModule,
    AuthModule,
    NotificationsModule,
    AvailabilityModule,
    CatalogModule,
    BusinessesModule,
    ServicesModule,
    ProfessionalsModule,
    AdminModule,
    AppointmentsModule,
    MarketplaceModule,
    BlocksModule,
    ReviewsModule,
    FavoritesModule,
    MeModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    // Ordem importa: limite de taxa → autenticação → papel.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
