import { resolve } from 'node:path';

export const TEST_PORT = 3399;
export const API = `http://localhost:${TEST_PORT}/api`;
export const FRONTEND = 'http://localhost:3000';
export const OUTBOX_FILE = resolve(__dirname, '..', 'tmp', 'test-outbox.jsonl');
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://belezaour:belezaour@localhost:5433/belezaour_test?schema=public';
export const ADMIN_EMAIL = 'admin@test.belezaour.local';
export const ADMIN_PASSWORD = 'Admin-Test-Password-123';

export function serverEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NODE_ENV: 'test',
    PORT: String(TEST_PORT),
    DATABASE_URL: TEST_DATABASE_URL,
    // Fixo entre execuções: o segredo TOTP do admin de teste fica cifrado com ele.
    // Valor exclusivo do banco de teste local; nunca usado em outro ambiente.
    BETTER_AUTH_SECRET: 'test-only-secret-belezaour-e2e-0000000000000000',
    BETTER_AUTH_URL: `http://localhost:${TEST_PORT}`,
    FRONTEND_URL: FRONTEND,
    CORS_ORIGINS: FRONTEND,
    RESEND_API_KEY: '',
    CLOUDINARY_URL: '',
    ADMIN_EMAIL,
    ADMIN_PASSWORD,
    SWAGGER_ENABLED: 'false',
    TRUST_PROXY_HOPS: '0',
    TEST_OUTBOX_FILE: OUTBOX_FILE,
    SCHEDULER_INTERVAL_MS: '1000',
  };
}
