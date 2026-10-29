import { All, Controller, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { toNodeHandler } from 'better-auth/node';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { CLIENT_IP_HEADER } from './better-auth';
import { Public } from './decorators';

/**
 * Encaminha /api/auth/* para o Better Auth. O rate limit dessas rotas é do
 * próprio Better Auth (regras por rota em better-auth.ts).
 */
@ApiExcludeController()
@Public()
@SkipThrottle()
@Controller('auth')
export class AuthController {
  private readonly handler: ReturnType<typeof toNodeHandler>;

  constructor(authService: AuthService) {
    this.handler = toNodeHandler(authService.auth);
  }

  @All('*path')
  handle(@Req() req: Request, @Res() res: Response): Promise<void> {
    // IP confiável vem do Express (trust proxy); valor enviado pelo cliente é descartado.
    req.headers[CLIENT_IP_HEADER] = req.ip ?? '';
    return this.handler(req, res);
  }
}
