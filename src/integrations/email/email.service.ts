import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';
import { loadEnv } from '../../config/env';
import { maskEmail } from '../../common/utils/mask';
import { appendTestOutbox } from '../test-outbox';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
}

/** Conteúdo de usuário em e-mail é escapado como em qualquer HTML. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function emailLayout(
  title: string,
  paragraphs: string[],
  action?: { label: string; url: string },
): string {
  const body = paragraphs.map((p) => `<p style="margin:0 0 12px">${p}</p>`).join('');
  const button = action
    ? `<p><a href="${escapeHtml(action.url)}" style="background:#1f6f7a;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;display:inline-block">${escapeHtml(action.label)}</a></p>`
    : '';
  return `<div style="font-family:'Noto Sans',Arial,sans-serif;color:#14242b;max-width:520px">
<h2 style="margin:0 0 16px">${escapeHtml(title)}</h2>${body}${button}
<p style="color:#66737a;font-size:12px;margin-top:24px">belezaOur · Goiânia-GO</p></div>`;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly env = loadEnv();
  private readonly client = this.env.RESEND_API_KEY ? new Resend(this.env.RESEND_API_KEY) : null;

  /** Nunca lança: falha de e-mail é registrada e não desfaz a operação (Princípio XI). */
  async send(message: EmailMessage): Promise<boolean> {
    if (this.env.NODE_ENV === 'test') {
      appendTestOutbox('email', message);
      return true;
    }
    if (!this.client) {
      this.logger.log(`[dev] e-mail "${message.subject}" para ${maskEmail(message.to)}`);
      return true;
    }
    try {
      const { error } = await this.client.emails.send({
        from: this.env.EMAIL_FROM,
        to: message.to,
        subject: message.subject,
        html: message.html,
      });
      if (error) {
        this.logger.error(`Resend recusou e-mail para ${maskEmail(message.to)}: ${error.name}`);
        return false;
      }
      return true;
    } catch (e) {
      this.logger.error(
        `Falha ao enviar e-mail para ${maskEmail(message.to)}: ${e instanceof Error ? e.message : 'erro'}`,
      );
      return false;
    }
  }
}
