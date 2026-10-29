import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Business } from '@prisma/client';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { Roles } from '../auth/decorators';
import { AvailabilityService, OWNER_WINDOW_DAYS } from '../availability/availability.service';
import {
  ActiveBusinessRequired,
  OwnerBusiness,
  OwnerBusinessGuard,
} from '../businesses/owner-business.guard';
import { Errors } from '../common/errors';
import { paginationSchema } from '../common/utils/pagination';
import { DATE_REGEX } from '../common/utils/time';
import { OWNER_ACTIONS } from './appointment-transitions';
import { AvailabilityQuery, CounterAppointmentDto } from './appointment.schemas';
import { AppointmentsService } from './appointments.service';
import { OwnerAgendaService } from './owner-agenda.service';

const date = z.string().regex(DATE_REGEX, 'Use YYYY-MM-DD');
const agendaSchema = z
  .object({
    from: date,
    to: date,
    professionalIds: z
      .string()
      .optional()
      .transform((v) => (v ? v.split(',') : undefined))
      .pipe(z.array(z.string().uuid()).max(50).optional()),
  })
  .strict();
class AgendaQuery extends createZodDto(agendaSchema) {}

const overviewSchema = z.object({ date: date.optional() }).strict();
class OverviewQuery extends createZodDto(overviewSchema) {}

class ClientsQuery extends createZodDto(paginationSchema.strict()) {}

const actionSchema = z.enum(OWNER_ACTIONS);

@ApiTags('Dono · Agenda')
@Roles('BUSINESS_OWNER')
@UseGuards(OwnerBusinessGuard)
@ActiveBusinessRequired()
@Controller('owner')
export class OwnerAppointmentsController {
  constructor(
    private readonly appointments: AppointmentsService,
    private readonly agendaService: OwnerAgendaService,
    private readonly availability: AvailabilityService,
  ) {}

  @Get('overview')
  overview(@OwnerBusiness() business: Business, @Query() query: OverviewQuery) {
    return this.agendaService.overview(business.id, query.date);
  }

  @Get('agenda')
  agenda(@OwnerBusiness() business: Business, @Query() query: AgendaQuery) {
    return this.agendaService.agenda(business.id, query.from, query.to, query.professionalIds);
  }

  @Get('availability')
  async availabilityForOwner(
    @OwnerBusiness() business: Business,
    @Query() query: AvailabilityQuery,
  ) {
    const slots = await this.availability.slots({
      businessId: business.id,
      ...query,
      windowDays: OWNER_WINDOW_DAYS,
    });
    return { date: query.date, slots };
  }

  @Get('clients')
  clients(@OwnerBusiness() business: Business, @Query() query: ClientsQuery) {
    return this.agendaService.clients(business.id, query);
  }

  @Get('appointments/:id')
  detail(@OwnerBusiness() business: Business, @Param('id', ParseUUIDPipe) id: string) {
    return this.appointments.ownerDetail(business.id, id);
  }

  @Post('appointments')
  counter(@OwnerBusiness() business: Business, @Body() dto: CounterAppointmentDto) {
    return this.appointments.createFromCounter(business, dto);
  }

  @Post('appointments/:id/:action')
  @HttpCode(200)
  act(
    @OwnerBusiness() business: Business,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('action') action: string,
  ) {
    const parsed = actionSchema.safeParse(action);
    if (!parsed.success) throw Errors.notFound('Ação');
    return this.appointments.ownerAction(business.id, id, parsed.data);
  }
}
