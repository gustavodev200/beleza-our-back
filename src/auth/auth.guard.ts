import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import { ALLOWS_MFA_ENROLLMENT_KEY, IS_PUBLIC_KEY, type AuthenticatedRequest } from './decorators';

export const ADMIN_SESSION_MAX_MS = 8 * 60 * 60 * 1000;

/**
 * Guard global. Sessão válida não basta: papel, bloqueio e 2FA são relidos do
 * banco a cada requisição, porque podem mudar no meio da sessão (Princípio III).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const session = await this.authService.getSession(request.headers);
    if (!session?.user) {
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: 'Faça login para continuar',
      });
    }

    const user = await this.prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        banned: true,
        anonymizedAt: true,
        twoFactorEnabled: true,
        phoneNumber: true,
        phoneNumberVerified: true,
        emailVerified: true,
      },
    });
    if (!user || user.anonymizedAt) {
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: 'Faça login para continuar',
      });
    }
    if (user.banned) {
      throw new ForbiddenException({ code: 'ACCOUNT_BLOCKED', message: 'Conta bloqueada' });
    }

    if (user.role === 'SUPER_ADMIN') {
      const age = Date.now() - new Date(session.session.createdAt).getTime();
      if (age > ADMIN_SESSION_MAX_MS) {
        throw new UnauthorizedException({
          code: 'ADMIN_SESSION_EXPIRED',
          message: 'Sessão administrativa expirada. Entre novamente.',
        });
      }
      const allowsEnrollment = this.reflector.getAllAndOverride<boolean>(
        ALLOWS_MFA_ENROLLMENT_KEY,
        targets,
      );
      if (!user.twoFactorEnabled && !allowsEnrollment) {
        throw new ForbiddenException({
          code: 'MFA_ENROLLMENT_REQUIRED',
          message: 'Ative a verificação em duas etapas para continuar.',
        });
      }
    }

    (request as AuthenticatedRequest).user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      phoneNumber: user.phoneNumber,
      phoneNumberVerified: Boolean(user.phoneNumberVerified),
      emailVerified: user.emailVerified,
    };
    return true;
  }
}
