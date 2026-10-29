import { execSync, spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { API, OUTBOX_FILE, serverEnv } from './test-env';

const root = resolve(__dirname, '..');

async function waitForHealth(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${API}/health`);
      if (res.ok) return;
    } catch {
      // servidor ainda subindo
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('API de teste não respondeu a tempo');
}

export default async function globalSetup(): Promise<void> {
  const env = serverEnv();
  rmSync(OUTBOX_FILE, { force: true });
  mkdirSync(dirname(OUTBOX_FILE), { recursive: true });

  // Não destrutivo: aplica migrations pendentes no banco de teste e semeia de
  // forma idempotente. Os testes criam dados únicos, então não dependem de
  // banco vazio (o segredo TOTP do admin fica em tmp/admin-totp.txt).
  execSync('npx prisma migrate deploy', { cwd: root, env, stdio: 'inherit' });
  execSync('npx ts-node prisma/seed.ts', { cwd: root, env, stdio: 'inherit' });
  execSync('npx nest build', { cwd: root, env, stdio: 'inherit' });

  const server = spawn(process.execPath, ['dist/main.js'], { cwd: root, env, stdio: 'inherit' });
  (globalThis as { __API_SERVER__?: typeof server }).__API_SERVER__ = server;
  await waitForHealth(30_000);
}
