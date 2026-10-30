import {
  Controller,
  Headers,
  HttpCode,
  NotFoundException,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Public } from '../auth/decorators';
import { loadEnv } from '../config/env';
import { NotificationsScheduler } from './notifications.scheduler';

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/**
 * Gatilho do cron externo (ex.: cron-job.org a cada minuto). Na hospedagem
 * gratuita a instância dorme sem tráfego e o setInterval para junto; esta
 * chamada a acorda e roda o mesmo tick. Sem CRON_SECRET a rota não existe.
 */
@ApiExcludeController()
@Controller('internal/cron')
export class CronController {
  private readonly secret = loadEnv().CRON_SECRET;

  constructor(private readonly scheduler: NotificationsScheduler) {}

  @Public()
  @SkipThrottle()
  @Post('tick')
  @HttpCode(200)
  tick(@Headers('authorization') authorization?: string) {
    if (!this.secret) throw new NotFoundException();
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
    // Hash antes de comparar: timingSafeEqual exige o mesmo tamanho.
    if (!timingSafeEqual(digest(token), digest(this.secret))) throw new UnauthorizedException();
    return this.scheduler.tick();
  }
}
