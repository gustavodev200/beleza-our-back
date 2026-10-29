import { Module } from '@nestjs/common';
import { BusinessesModule } from '../businesses/businesses.module';
import { AppointmentsService } from './appointments.service';
import { ClientAppointmentsController } from './client-appointments.controller';
import { OwnerAgendaService } from './owner-agenda.service';
import { OwnerAppointmentsController } from './owner-appointments.controller';

@Module({
  imports: [BusinessesModule],
  controllers: [ClientAppointmentsController, OwnerAppointmentsController],
  providers: [AppointmentsService, OwnerAgendaService],
  exports: [AppointmentsService, OwnerAgendaService],
})
export class AppointmentsModule {}
