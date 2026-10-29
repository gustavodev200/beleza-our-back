import { Injectable } from '@nestjs/common';
import { fromNodeHeaders } from 'better-auth/node';
import type { IncomingHttpHeaders } from 'node:http';
import { loadEnv } from '../config/env';
import { EmailService } from '../integrations/email/email.service';
import { WhatsappService } from '../integrations/whatsapp/whatsapp.service';
import { PrismaService } from '../prisma/prisma.service';
import { createAuth, type Auth } from './better-auth';

/** Dono da instância do Better Auth dentro do container de DI. */
@Injectable()
export class AuthService {
  readonly auth: Auth;

  constructor(
    private readonly prisma: PrismaService,
    email: EmailService,
    whatsapp: WhatsappService,
  ) {
    this.auth = createAuth({ prisma, env: loadEnv(), email, whatsapp });
  }

  getSession(headers: IncomingHttpHeaders) {
    return this.auth.api.getSession({ headers: fromNodeHeaders(headers) });
  }

  /** Encerra todas as sessões (ban, exclusão de conta). */
  async revokeAllSessions(userId: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { userId } });
  }
}
