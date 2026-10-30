import { createHmac, randomInt } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  API,
  FRONTEND,
  OUTBOX_FILE,
  TEST_DATABASE_URL,
} from './test-env';

export const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }),
});

export interface ApiResponse<T = any> {
  status: number;
  body: T;
  headers: Headers;
}

/** Cliente HTTP com cookie jar (simula um navegador do front). */
export class HttpClient {
  private cookies = new Map<string, string>();

  async request<T = any>(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = { Origin: FRONTEND, ...extraHeaders };
    let payload: BodyInit | undefined;
    if (body instanceof FormData) {
      payload = body;
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    if (this.cookies.size) {
      headers.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    }
    const res = await fetch(`${API}${path}`, {
      method,
      headers,
      body: payload,
      redirect: 'manual',
    });
    for (const cookie of res.headers.getSetCookie()) {
      const [pair] = cookie.split(';');
      const index = pair.indexOf('=');
      const name = pair.slice(0, index);
      const value = pair.slice(index + 1);
      if (value === '' || /max-age=0/i.test(cookie)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // resposta não-JSON
    }
    return { status: res.status, body: parsed as T, headers: res.headers };
  }

  get<T = any>(path: string) {
    return this.request<T>('GET', path);
  }
  post<T = any>(path: string, body?: unknown) {
    return this.request<T>('POST', path, body ?? {});
  }
  patch<T = any>(path: string, body?: unknown) {
    return this.request<T>('PATCH', path, body ?? {});
  }
  put<T = any>(path: string, body?: unknown) {
    return this.request<T>('PUT', path, body ?? {});
  }
  delete<T = any>(path: string) {
    return this.request<T>('DELETE', path);
  }
}

interface OutboxEntry {
  channel: 'email' | 'whatsapp';
  to: string;
  subject?: string;
  html?: string;
  text?: string;
}

export function readOutbox(): OutboxEntry[] {
  if (!existsSync(OUTBOX_FILE)) return [];
  return readFileSync(OUTBOX_FILE, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as OutboxEntry);
}

export async function waitFor<T>(
  fn: () => T | undefined | Promise<T | undefined>,
  timeoutMs = 5000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value !== undefined) return value;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('waitFor: condição não satisfeita a tempo');
}

export function lastEmailTo(email: string, subjectIncludes: string): Promise<OutboxEntry> {
  return waitFor(() =>
    readOutbox()
      .filter(
        (m) => m.channel === 'email' && m.to === email && m.subject?.includes(subjectIncludes),
      )
      .at(-1),
  );
}

export function linkFrom(html: string): string {
  const match = /href="([^"]+)"/.exec(html);
  if (!match) throw new Error('link não encontrado no e-mail');
  return match[1].replace(/&amp;/g, '&');
}

export async function lastOtpFor(phone: string, after = 0): Promise<string> {
  const message = await waitFor(() =>
    readOutbox()
      .slice(after)
      .filter((m) => m.channel === 'whatsapp' && m.to === phone && /código/.test(m.text ?? ''))
      .at(-1),
  );
  return /\b(\d{4})\b/.exec(message.text ?? '')![1];
}

let seq = 0;
export function uniqueEmail(prefix = 'dono'): string {
  seq += 1;
  return `${prefix}.${Date.now()}.${seq}.${randomInt(1e6)}@test.belezaour.local`;
}
export function uniquePhone(): string {
  return `+55629${String(randomInt(10_000_000, 99_999_999))}`;
}

// --- TOTP (RFC 6238) para o admin -------------------------------------------

function base32Decode(input: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of input.replace(/=+$/, '').toUpperCase()) {
    bits += alphabet.indexOf(char).toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

export function totp(secretBase32: string, now = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)));
  const hmac = createHmac('sha1', base32Decode(secretBase32)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, '0');
}

// --- Sessões prontas ----------------------------------------------------------

/** CPF com dígitos verificadores válidos e único por chamada. */
export function uniqueCpf(): string {
  const base = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const digit = (nums: number[]) => {
    const rest = nums.reduce((a, n, i) => a + n * (nums.length + 1 - i), 0) % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  const d1 = digit(base);
  const d2 = digit([...base, d1]);
  return [...base, d1, d2].join('');
}

export async function signUpOwner(email = uniqueEmail(), password = 'senha-forte-123') {
  const http = new HttpClient();
  const res = await http.post('/auth/sign-up/email', {
    name: 'Dona Teste',
    email,
    password,
    cpfCnpj: uniqueCpf(),
    acceptedTerms: true,
  });
  if (res.status !== 200)
    throw new Error(`sign-up falhou: ${res.status} ${JSON.stringify(res.body)}`);
  return { http, email, password };
}

export async function verifyEmailOf(email: string): Promise<void> {
  const mail = await lastEmailTo(email, 'Confirme seu e-mail');
  const url = new URL(linkFrom(mail.html!));
  const res = await fetch(url, { redirect: 'manual', headers: { Origin: FRONTEND } });
  if (res.status >= 400) throw new Error(`verificação falhou: ${res.status}`);
}

/** Dono com e-mail verificado e sessão ativa. */
export async function ownerSession() {
  const owner = await signUpOwner();
  await verifyEmailOf(owner.email);
  const res = await owner.http.post('/auth/sign-in/email', {
    email: owner.email,
    password: owner.password,
  });
  if (res.status !== 200) throw new Error(`login do dono falhou: ${res.status}`);
  const user = await prisma.user.findUniqueOrThrow({ where: { email: owner.email } });
  return { ...owner, userId: user.id };
}

export async function signUpClient(email = uniqueEmail('cliente'), password = 'senha-forte-123') {
  const http = new HttpClient();
  const res = await http.post('/auth/sign-up/email', {
    name: 'Cliente Teste',
    email,
    password,
    accountType: 'client',
    acceptedTerms: true,
  });
  if (res.status !== 200)
    throw new Error(`sign-up da cliente falhou: ${res.status} ${JSON.stringify(res.body)}`);
  return { http, email, password };
}

/** Cliente por e-mail e senha, com e-mail verificado e sessão ativa (sem telefone). */
export async function emailClientSession() {
  const client = await signUpClient();
  await verifyEmailOf(client.email);
  const res = await client.http.post('/auth/sign-in/email', {
    email: client.email,
    password: client.password,
  });
  if (res.status !== 200) throw new Error(`login da cliente falhou: ${res.status}`);
  const user = await prisma.user.findUniqueOrThrow({ where: { email: client.email } });
  return { ...client, userId: user.id };
}

/** Cliente logada por código de WhatsApp. */
export async function clientSession(phone = uniquePhone()) {
  const http = new HttpClient();
  const before = readOutbox().length;
  const sent = await http.post('/auth/phone-number/send-otp', { phoneNumber: phone });
  if (sent.status !== 200)
    throw new Error(`send-otp falhou: ${sent.status} ${JSON.stringify(sent.body)}`);
  const code = await lastOtpFor(phone, before);
  const verified = await http.post('/auth/phone-number/verify', { phoneNumber: phone, code });
  if (verified.status !== 200)
    throw new Error(`verify falhou: ${verified.status} ${JSON.stringify(verified.body)}`);
  const user = await prisma.user.findUniqueOrThrow({ where: { phoneNumber: phone } });
  return { http, phone, userId: user.id };
}

// Persistido em arquivo: o Jest isola módulos por suíte, e o 2FA só é ativado uma vez.
const TOTP_FILE = OUTBOX_FILE.replace('test-outbox.jsonl', 'admin-totp.txt');

/** Admin semeado, com 2FA ativado na primeira chamada. */
export async function adminSession() {
  const http = new HttpClient();
  let adminTotpSecret = existsSync(TOTP_FILE) ? readFileSync(TOTP_FILE, 'utf8') : undefined;
  const signIn = await http.post('/auth/sign-in/email', {
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  });
  if (signIn.status !== 200) throw new Error(`login admin falhou: ${signIn.status}`);

  if (!adminTotpSecret) {
    const enabled = await http.post('/auth/two-factor/enable', { password: ADMIN_PASSWORD });
    if (enabled.status !== 200)
      throw new Error(`enable 2FA falhou: ${enabled.status} ${JSON.stringify(enabled.body)}`);
    adminTotpSecret = new URL(enabled.body.totpURI as string).searchParams.get('secret')!;
    writeFileSync(TOTP_FILE, adminTotpSecret);
    const verify = await http.post('/auth/two-factor/verify-totp', { code: totp(adminTotpSecret) });
    if (verify.status !== 200) throw new Error(`verify 2FA falhou: ${verify.status}`);
    return { http };
  }

  if (signIn.body?.twoFactorRedirect) {
    const verify = await http.post('/auth/two-factor/verify-totp', { code: totp(adminTotpSecret) });
    if (verify.status !== 200) throw new Error(`2FA falhou: ${verify.status}`);
  }
  return { http };
}

export function nextWeekday(weekday: number, from = new Date()): string {
  // Data (YYYY-MM-DD) do próximo dia da semana em São Paulo, a partir de amanhã.
  const sp = new Date(from.getTime() - 3 * 3_600_000);
  for (let i = 1; i <= 7; i += 1) {
    const d = new Date(Date.UTC(sp.getUTCFullYear(), sp.getUTCMonth(), sp.getUTCDate() + i));
    if (d.getUTCDay() === weekday) return d.toISOString().slice(0, 10);
  }
  throw new Error('impossível');
}

/** Instante UTC para data/hora local de São Paulo (UTC-3). */
export function spInstant(date: string, hhmm: string): string {
  return new Date(`${date}T${hhmm}:00.000-03:00`).toISOString();
}

// --- Estabelecimento ------------------------------------------------------------

export async function catalogIds() {
  const city = await prisma.city.findUniqueOrThrow({ where: { slug: 'goiania-go' } });
  const categories = await prisma.category.findMany({ orderBy: { sortOrder: 'asc' } });
  return { cityId: city.id, categoryId: categories[0].id, categories };
}

export const WEEK_HOURS = [1, 2, 3, 4, 5, 6].map((weekday) => ({
  weekday,
  opensAt: '09:00',
  closesAt: '18:00',
  breakStart: '12:00',
  breakEnd: '13:00',
}));

/**
 * Dono com estabelecimento completo: 1 serviço (60 min, R$ 50) e 2 profissionais
 * aptas. `activate` pula a moderação gravando ACTIVE direto (testes de agenda).
 */
export async function businessFixture(
  opts: { activate?: boolean; requiresConfirmation?: boolean; name?: string } = {},
) {
  const owner = await ownerSession();
  const { cityId, categoryId } = await catalogIds();
  const created = await owner.http.post('/owner/business', {
    type: 'SALON',
    name: opts.name ?? `Studio Teste ${randomInt(1e6)}`,
    whatsapp: uniquePhone(),
    cityId,
    neighborhood: 'Setor Bueno',
    categoryIds: [categoryId],
    requiresConfirmation: opts.requiresConfirmation ?? false,
  });
  if (created.status !== 201)
    throw new Error(`criar estabelecimento: ${created.status} ${JSON.stringify(created.body)}`);
  await owner.http.put('/owner/business/hours', { days: WEEK_HOURS });
  const service = await owner.http.post('/owner/services', {
    name: 'Escova Modelada',
    categoryId,
    durationMinutes: 60,
    priceCents: 5000,
  });
  const ana = await owner.http.post('/owner/professionals', {
    name: 'Ana',
    serviceIds: [service.body.id],
  });
  const bia = await owner.http.post('/owner/professionals', {
    name: 'Bia',
    serviceIds: [service.body.id],
  });
  if (opts.activate !== false) {
    await prisma.business.update({
      where: { id: created.body.id },
      data: { status: 'ACTIVE', approvedAt: new Date() },
    });
  }
  return {
    owner,
    business: created.body as { id: string; slug: string },
    serviceId: service.body.id as string,
    professionalIds: [ana.body.id as string, bia.body.id as string],
    categoryId,
  };
}

/**
 * n-ésimo dia de funcionamento (seg–sáb) a partir de amanhã, em São Paulo.
 * Sempre dentro da janela de 7 dias da cliente (n de 1 a 5).
 */
export function workday(n: number, from = new Date()): string {
  const sp = new Date(from.getTime() - 3 * 3_600_000);
  let found = 0;
  for (let i = 1; i <= 6; i += 1) {
    const d = new Date(Date.UTC(sp.getUTCFullYear(), sp.getUTCMonth(), sp.getUTCDate() + i));
    if (d.getUTCDay() !== 0) found += 1;
    if (found === n) return d.toISOString().slice(0, 10);
  }
  throw new Error(`workday(${n}) fora da janela`);
}
