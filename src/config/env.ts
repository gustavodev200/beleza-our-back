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
    // Intervalo do agendador de lembretes (5 min em produção; curto nos testes).
    SCHEDULER_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(500)
      .default(5 * 60_000),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    // Em produção um serviço externo ausente é configuração errada, não modo de log.
    for (const key of ['RESEND_API_KEY', 'CLOUDINARY_URL'] as const) {
      if (!env[key]) {
        ctx.addIssue({ code: 'custom', path: [key], message: `${key} é obrigatório em produção` });
      }
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

/** Origens permitidas para CORS e Better Auth (sempre inclui o front). */
export function allowedOrigins(env: Env): string[] {
  return Array.from(new Set([env.FRONTEND_URL, ...env.CORS_ORIGINS]));
}
