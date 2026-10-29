import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Role } from '@prisma/client';
import type { Request } from 'express';

export const IS_PUBLIC_KEY = 'isPublic';
export const ROLES_KEY = 'roles';
export const ALLOWS_MFA_ENROLLMENT_KEY = 'allowsMfaEnrollment';

/** Rota sem autenticação. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Papéis aceitos (checagem fina de ownership continua no service). */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/** Admin sem 2FA pode acessar (somente a rota de status/cadastro do 2FA). */
export const AllowsMfaEnrollment = () => SetMetadata(ALLOWS_MFA_ENROLLMENT_KEY, true);

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  phoneNumber: string | null;
  phoneNumberVerified: boolean;
  emailVerified: boolean;
}

export type AuthenticatedRequest = Request & { user: AuthUser };

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    return ctx.switchToHttp().getRequest<AuthenticatedRequest>().user;
  },
);
