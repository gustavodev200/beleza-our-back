import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, Roles, type AuthUser } from '../auth/decorators';
import { loadEnv } from '../config/env';
import { CreateAppointmentDto, MyAppointmentsQuery, RescheduleDto } from './appointment.schemas';
import { AppointmentsService } from './appointments.service';

@ApiTags('Cliente · Agendamentos')
@Roles('CLIENT')
@Controller()
export class ClientAppointmentsController {
  constructor(private readonly appointments: AppointmentsService) {}

  @Post('appointments')
  // Em teste todas as requisições saem do mesmo IP (ver app.module.ts).
  @Throttle({ default: { limit: loadEnv().NODE_ENV === 'test' ? 100_000 : 20, ttl: 60_000 } })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateAppointmentDto) {
    return this.appointments.createFromApp(user, dto);
  }

  @Get('me/appointments')
  list(@CurrentUser() user: AuthUser, @Query() query: MyAppointmentsQuery) {
    return this.appointments.listMine(user.id, query.scope, query);
  }

  @Get('me/appointments/:id')
  detail(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.appointments.mine(user.id, id);
  }

  @Patch('me/appointments/:id/reschedule')
  reschedule(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RescheduleDto,
  ) {
    return this.appointments.rescheduleByClient(user.id, id, dto);
  }

  @Post('me/appointments/:id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.appointments.cancelByClient(user.id, id);
  }
}
