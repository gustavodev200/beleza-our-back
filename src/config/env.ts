import { z } from 'zod';

const csv = z
  .string()
  .default('')
  .transform((raw) =>
    raw
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean),
  );

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3333),
    DATABASE_URL: z.string().url(),
    BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET precisa de ao menos 32 caracteres'),
    BETTER_AUTH_URL: z.string().url(),
    FRONTEND_URL: z.string().url(),
    CORS_ORIGINS: csv,
    RESEND_API_KEY: z.string().optional().default(''),
    EMAIL_FROM: z.string().min(3).default('belezaOur <nao-responda@belezaour.app>'),
    CLOUDINARY_URL: z.string().optional().default(''),
    ADMIN_EMAIL: z.string().email().optional().or(z.literal('')),
    ADMIN_PASSWORD: z.string().optional().default(''),
    SWAGGER_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
    // Web Push (PWA). Gere o par com: npx web-push generate-vapid-keys
    VAPID_PUBLIC_KEY: z.string().optional().default(''),
    VAPID_PRIVATE_KEY: z.string().optional().default(''),
    VAPID_SUBJECT: z.string().default('mailto:suporte@belezaour.app'),
    // Segredo do cron externo (POST /api/internal/cron/tick). Vazio = rota desligada.
    CRON_SECRET: z.string().optional().default(''),
    // Intervalo do agendador interno (1 min: lembrete de 15 min e "na hora" precisam
    // de precisão; curto nos testes). O cron externo chama o mesmo tick.
    SCHEDULER_INTERVAL_MS: z.coerce.number().int().min(500).default(60_000),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    // Integrações ausentes não impedem o boot (ambiente de teste sem chaves);
    // main.ts avisa no log. Ver missingIntegrations.
    if (env.CRON_SECRET && env.CRON_SECRET.length < 32) {
      ctx.addIssue({
        code: 'custom',
        path: ['CRON_SECRET'],
        message: 'CRON_SECRET precisa de ao menos 32 caracteres',
      });
    }
    if (env.SWAGGER_ENABLED) {
      ctx.addIssue({
        code: 'custom',
        path: ['SWAGGER_ENABLED'],
        message: 'Swagger não pode ficar ativo em produção',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/** Valida process.env uma vez; a aplicação não sobe com configuração inválida. */
export function loadEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // Só nomes de variáveis e mensagens — nunca valores.
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuração de ambiente inválida:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/**
 * Integrações sem chave: e-mails só vão para o log, uploads usam URL fictícia,
 * push não sai e o cron externo fica desligado (só o agendador interno roda).
 */
export function missingIntegrations(env: Env): string[] {
  return (
    [
      'RESEND_API_KEY',
      'CLOUDINARY_URL',
      'VAPID_PUBLIC_KEY',
      'VAPID_PRIVATE_KEY',
      'CRON_SECRET',
    ] as const
  ).filter((key) => !env[key]);
}

/** Origens permitidas para CORS e Better Auth (sempre inclui o front). */
export function allowedOrigins(env: Env): string[] {
  return Array.from(new Set([env.FRONTEND_URL, ...env.CORS_ORIGINS]));
}
