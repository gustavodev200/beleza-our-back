import { Injectable, Logger } from '@nestjs/common';
import webpush, { WebPushError } from 'web-push';
import { loadEnv } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { appendTestOutbox } from '../test-outbox';

export interface PushMessage {
  title: string;
  body: string;
  /** Rota do front aberta ao tocar na notificação. */
  url: string;
  /** Mesma tag substitui a notificação anterior no aparelho. */
  tag?: string;
}

/**
 * Web Push (VAPID) para todos os aparelhos inscritos do usuário. Sem chaves,
 * nada sai (só log). Inscrição expirada (404/410) é apagada.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private readonly env = loadEnv();
  readonly enabled = Boolean(this.env.VAPID_PUBLIC_KEY && this.env.VAPID_PRIVATE_KEY);

  constructor(private readonly prisma: PrismaService) {
    if (this.enabled) {
      webpush.setVapidDetails(
        this.env.VAPID_SUBJECT,
        this.env.VAPID_PUBLIC_KEY,
        this.env.VAPID_PRIVATE_KEY,
      );
    }
  }

  get publicKey(): string | null {
    return this.enabled ? this.env.VAPID_PUBLIC_KEY : null;
  }

  /** Nunca lança: falha de push não desfaz a operação (Princípio XI). */
  async sendToUser(userId: string, message: PushMessage): Promise<number> {
    try {
      const subs = await this.prisma.pushSubscription.findMany({ where: { userId } });
      if (!subs.length) return 0;
      if (this.env.NODE_ENV === 'test') {
        appendTestOutbox('push', { userId, ...message });
        return subs.length;
      }
      if (!this.enabled) {
        this.logger.log(`[push] "${message.title}" para ${subs.length} aparelho(s) (sem VAPID)`);
        return 0;
      }
      const payload = JSON.stringify(message);
      let sent = 0;
      for (const sub of subs) {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload,
            {
              TTL: 30 * 60,
              urgency: 'high',
              topic: message.tag?.replace(/[^\w-]/g, '').slice(0, 32) || undefined,
            },
          );
          sent++;
          await this.prisma.pushSubscription.update({
            where: { id: sub.id },
            data: { lastUsedAt: new Date() },
          });
        } catch (e) {
          if (e instanceof WebPushError && (e.statusCode === 404 || e.statusCode === 410)) {
            await this.prisma.pushSubscription.deleteMany({ where: { id: sub.id } });
          } else {
            const status = e instanceof WebPushError ? e.statusCode : 'erro';
            this.logger.error(`Falha no push (${status})`);
          }
        }
      }
      return sent;
    } catch (e) {
      this.logger.error(`Falha no push: ${e instanceof Error ? e.message : 'erro'}`);
      return 0;
    }
  }
}
