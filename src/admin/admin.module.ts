import { Module } from '@nestjs/common';
import { AppointmentsModule } from '../appointments/appointments.module';
import { AdminBusinessesController, AdminBusinessesService } from './admin-businesses';
import { AdminDashboardController, AdminDashboardService } from './admin-dashboard';
import { AdminPlatformController, AdminPlatformService } from './admin-platform';

@Module({
  imports: [AppointmentsModule],
  controllers: [AdminBusinessesController, AdminPlatformController, AdminDashboardController],
  providers: [AdminBusinessesService, AdminPlatformService, AdminDashboardService],
})
export class AdminModule {}
