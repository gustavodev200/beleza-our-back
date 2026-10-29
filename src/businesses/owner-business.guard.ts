import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Business } from '@prisma/client';
import type { AuthenticatedRequest } from '../auth/decorators';
import { Errors } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';

const ACTIVE_REQUIRED_KEY = 'activeBusinessRequired';

/** Rotas operacionais (agenda, agendamentos, bloqueios) exigem estabelecimento ACTIVE (FR-018). */
export const ActiveBusinessRequired = () => SetMetadata(ACTIVE_REQUIRED_KEY, true);

type OwnerRequest = AuthenticatedRequest & { business: Business };

/**
 * Resolve o estabelecimento do dono **pela sessão** (Princípio VIII). Nenhuma
 * rota do painel recebe businessId do cliente; tudo é filtrado por este.
 */
@Injectable()
export class OwnerBusinessGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<OwnerRequest>();
    if (request.user?.role !== 'BUSINESS_OWNER') {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Acesso restrito ao dono do estabelecimento',
      });
    }
    const business = await this.prisma.business.findUnique({ where: { ownerId: request.user.id } });
    if (!business) throw Errors.notFound('Estabelecimento');
    const activeRequired = this.reflector.getAllAndOverride<boolean>(ACTIVE_REQUIRED_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (activeRequired && business.status !== 'ACTIVE') throw Errors.businessNotActive();
    request.business = business;
    return true;
  }
}

/** Estabelecimento do dono autenticado (já verificado pelo OwnerBusinessGuard). */
export const OwnerBusiness = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Business =>
    ctx.switchToHttp().getRequest<OwnerRequest>().business,
);
