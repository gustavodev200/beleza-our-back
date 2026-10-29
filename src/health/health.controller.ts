import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../auth/decorators';

@ApiTags('Health')
@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  /** Só status — nada de versão, dependências ou conexão (data-secrets-logging.md). */
  @Get()
  check(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
