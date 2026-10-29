import { Injectable, Logger } from '@nestjs/common';
import { loadEnv } from '../../config/env';
import { maskPhone } from '../../common/utils/mask';
import { appendTestOutbox } from '../test-outbox';

export interface WhatsappMessage {
  to: string;
  text: string;
}

/**
 * Adaptador de WhatsApp. O provedor ainda não foi contratado (research R10):
 * no MVP a mensagem é registrada com o telefone mascarado e, em teste,
 * guardada em memória. Trocar o provedor = reimplementar `deliver`.
 */
@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);
  private readonly env = loadEnv();

  /** Nunca lança: falha de envio não desfaz a operação de negócio. */
  async send(message: WhatsappMessage): Promise<boolean> {
    try {
      await this.deliver(message);
      return true;
    } catch (e) {
      this.logger.error(
        `Falha no WhatsApp para ${maskPhone(message.to)}: ${e instanceof Error ? e.message : 'erro'}`,
      );
      return false;
    }
  }

  private deliver(message: WhatsappMessage): Promise<void> {
    if (this.env.NODE_ENV === 'test') {
      appendTestOutbox('whatsapp', message);
      return Promise.resolve();
    }
    // Conteúdo não é logado: pode conter código de acesso.
    this.logger.log(
      `[whatsapp] mensagem para ${maskPhone(message.to)} (${message.text.length} caracteres)`,
    );
    if (this.env.NODE_ENV === 'development' && /\b\d{4}\b/.test(message.text)) {
      // Só em dev, para conseguir entrar sem provedor real.
      this.logger.debug(`[whatsapp:dev] ${message.text}`);
    }
    return Promise.resolve();
  }
}
