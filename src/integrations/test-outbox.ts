import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Só em NODE_ENV=test: mensagens "enviadas" vão para um arquivo JSONL que os
 * testes e2e (processo separado) leem para obter códigos e links. Nenhuma rota
 * HTTP expõe isso.
 */
export function appendTestOutbox(channel: 'email' | 'whatsapp' | 'push', payload: object): void {
  const file = process.env.TEST_OUTBOX_FILE ?? 'tmp/test-outbox.jsonl';
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(
    file,
    `${JSON.stringify({ channel, at: new Date().toISOString(), ...payload })}\n`,
  );
}
