import { PrismaClient } from '@prisma/client';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { APIError, createAuthMiddleware, isAPIError } from 'better-auth/api';
import { phoneNumber, twoFactor } from 'better-auth/plugins';
import { allowedOrigins, type Env } from '../config/env';
import { emailLayout, escapeHtml, type EmailService } from '../integrations/email/email.service';
import type { WhatsappService } from '../integrations/whatsapp/whatsapp.service';
import { normalizeCpfCnpj } from '../common/utils/document';
import { BR_MOBILE_REGEX } from '../common/utils/phone';

/**
 * Header que o AuthController preenche com `req.ip` (já resolvido pelo Express
 * com o número de proxies confiáveis) depois de descartar qualquer valor
 * enviado pelo cliente. É a única fonte de IP do rate limiter do Better Auth.
 */
export const CLIENT_IP_HEADER = 'x-belezaour-client-ip';

export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_LOCK_MS = 15 * 60_000;
export const OTP_MAX_SENDS = 3;
export const OTP_WINDOW_MS = 10 * 60_000;
export const OTP_RESEND_COOLDOWN_MS = 30_000;
/**
 * Teto diário por telefone. Código de 4 dígitos (exigência do produto) com
 * 3 tentativas: sem este teto, 3 envios/10 min permitiriam ~1.300 palpites
 * por dia contra um mesmo número (security-review.md, achado SR-1).
 */
export const OTP_DAILY_MAX = 8;
export const OTP_DAILY_WINDOW_MS = 24 * 60 * 60_000;

/** Versão vigente dos Termos de Uso e da Política de Privacidade; gravada no aceite. */
export const TERMS_VERSION = '2026-10-29';

/** E-mail interno exigido pelo plugin de telefone; nunca exibido nem usado para envio. */
export const PHONE_EMAIL_DOMAIN = 'phone.belezaour.local';

interface AuthDeps {
  prisma: PrismaClient;
  env: Env;
  email: EmailService;
  whatsapp: WhatsappService;
}

/** Lê um campo string do corpo (não tipado) das rotas do Better Auth. */
function bodyText(body: unknown, key: string): string {
  const value =
    body && typeof body === 'object' ? (body as Record<string, unknown>)[key] : undefined;
  return typeof value === 'string' ? value : '';
}

/**
 * O mesmo /sign-up/email atende dono e cliente; o corpo traz `accountType:
 * "client"` no cadastro da cliente. O papel continua decidido aqui no servidor.
 */
function isClientSignUp(body: unknown): boolean {
  return bodyText(body, 'accountType') === 'client';
}

/** Regras do cadastro por e-mail (dono e cliente) antes do Better Auth criar a conta. */
async function checkEmailSignUp(prisma: PrismaClient, body: unknown): Promise<void> {
  if ((body as Record<string, unknown> | undefined)?.acceptedTerms !== true) {
    throw new APIError('BAD_REQUEST', {
      message: 'É preciso aceitar os Termos de Uso e a Política de Privacidade',
    });
  }
  // Domínio interno das contas por telefone: nunca pode ser cadastrado por e-mail.
  if (bodyText(body, 'email').toLowerCase().endsWith(`@${PHONE_EMAIL_DOMAIN}`)) {
    throw new APIError('BAD_REQUEST', { message: 'E-mail inválido' });
  }
  if (isClientSignUp(body)) return;

  const document = normalizeCpfCnpj(bodyText(body, 'cpfCnpj'));
  if (!document) throw new APIError('BAD_REQUEST', { message: 'CPF ou CNPJ inválido' });
  const taken = await prisma.user.findUnique({
    where: { cpfCnpj: document },
    select: { id: true },
  });
  if (taken) {
    throw new APIError('UNPROCESSABLE_ENTITY', {
      message: 'Já existe uma conta com este CPF ou CNPJ',
    });
  }
}

const tooMany = () =>
  new APIError('TOO_MANY_REQUESTS', { message: 'Muitas tentativas. Aguarde e tente novamente.' });

export function createAuth({ prisma, env, email, whatsapp }: AuthDeps) {
  const origins = allowedOrigins(env);

  return betterAuth({
    appName: 'belezaOur',
    baseURL: env.BETTER_AUTH_URL,
    basePath: '/api/auth',
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: origins,
    database: prismaAdapter(prisma, { provider: 'postgresql' }),
    telemetry: { enabled: false },

    user: {
      additionalFields: {
        // input:false — o cliente nunca define o próprio papel nem o bloqueio (FR-006).
        role: { type: 'string', required: false, input: false, defaultValue: 'CLIENT' },
        banned: { type: 'boolean', required: false, input: false, defaultValue: false },
        // Obrigatório no cadastro do dono (checado no hook); exigido pelo Asaas.
        cpfCnpj: { type: 'string', required: false, input: true },
        // Gravados pelo servidor a partir do aceite; o cliente não define.
        termsAcceptedAt: { type: 'date', required: false, input: false },
        termsVersion: { type: 'string', required: false, input: false },
      },
    },

    session: {
      expiresIn: SESSION_MAX_AGE_SECONDS,
      updateAge: 60 * 60 * 24,
      // Sem cache em cookie: revogação (reset de senha, bloqueio, logout) vale
      // na próxima requisição, ao custo de uma leitura de sessão no banco.
      cookieCache: { enabled: false },
    },

    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      requireEmailVerification: true,
      resetPasswordTokenExpiresIn: 30 * 60,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: ({ user, url }) => {
        // Sem await: o tempo de resposta não pode revelar se o e-mail existe.
        void email.send({
          to: user.email,
          subject: 'Redefinição de senha — belezaOur',
          html: emailLayout(
            'Redefinir sua senha',
            [
              `Olá, ${escapeHtml(user.name)}.`,
              'Recebemos um pedido para redefinir sua senha. O link vale por 30 minutos e só pode ser usado uma vez.',
              'Se não foi você, ignore este e-mail.',
            ],
            { label: 'Redefinir senha', url },
          ),
        });
        return Promise.resolve();
      },
    },

    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      expiresIn: 24 * 60 * 60,
      sendVerificationEmail: ({ user, url }) => {
        const isOwner = (user as { role?: string }).role === 'BUSINESS_OWNER';
        void email.send({
          to: user.email,
          subject: 'Confirme seu e-mail — belezaOur',
          html: emailLayout(
            'Confirme seu e-mail',
            [
              `Olá, ${escapeHtml(user.name)}.`,
              isOwner
                ? 'Confirme seu e-mail para acessar o painel do seu estabelecimento.'
                : 'Confirme seu e-mail para entrar na sua conta e agendar seus horários.',
            ],
            { label: 'Confirmar e-mail', url },
          ),
        });
        return Promise.resolve();
      },
    },

    rateLimit: {
      // Em teste todas as requisições vêm do mesmo IP; as regras por conta e
      // por telefone (hooks abaixo) continuam ativas e são testadas.
      enabled: env.NODE_ENV !== 'test',
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 15 * 60, max: 10 },
        '/sign-up/email': { window: 60 * 60, max: 5 },
        '/send-verification-email': { window: 60 * 60, max: 3 },
        '/request-password-reset': { window: 60 * 60, max: 3 },
        '/reset-password': { window: 60 * 60, max: 5 },
        // Por IP é mais folgado que por telefone: salões compartilham Wi-Fi (NAT).
        '/phone-number/send-otp': { window: 10 * 60, max: 10 },
        '/phone-number/verify': { window: 10 * 60, max: 10 },
        '/two-factor/verify-totp': { window: 15 * 60, max: 5 },
        '/two-factor/verify-backup-code': { window: 15 * 60, max: 5 },
      },
    },

    advanced: {
      cookiePrefix: 'belezaour',
      useSecureCookies: env.NODE_ENV === 'production',
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
    },

    databaseHooks: {
      user: {
        create: {
          // Papel decidido pelo fluxo, nunca pelo corpo da requisição (FR-006).
          before: (user, ctx) => {
            const isEmailSignUp = ctx?.path === '/sign-up/email';
            const isOwnerSignUp = isEmailSignUp && !isClientSignUp(ctx.body);
            return Promise.resolve({
              data: {
                ...user,
                role: isOwnerSignUp ? 'BUSINESS_OWNER' : 'CLIENT',
                banned: false,
                cpfCnpj: isOwnerSignUp ? normalizeCpfCnpj(bodyText(ctx.body, 'cpfCnpj')) : null,
                // O aceite é checado no hook before para os dois cadastros por e-mail.
                termsAcceptedAt: isEmailSignUp ? new Date() : null,
                termsVersion: isEmailSignUp ? TERMS_VERSION : null,
              },
            });
          },
        },
      },
      session: {
        create: {
          // Usuário bloqueado não obtém sessão por nenhum método.
          before: async (session) => {
            const user = await prisma.user.findUnique({
              where: { id: session.userId },
              select: { banned: true, anonymizedAt: true },
            });
            if (!user || user.banned || user.anonymizedAt) {
              throw new APIError('FORBIDDEN', { message: 'Conta indisponível' });
            }
          },
        },
      },
    },

    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === '/sign-up/email') await checkEmailSignUp(prisma, ctx.body);

        if (ctx.path === '/sign-in/email') {
          const emailInput = bodyText(ctx.body, 'email').toLowerCase();
          const user = await prisma.user.findUnique({
            where: { email: emailInput },
            select: { lockedUntil: true },
          });
          if (user?.lockedUntil && user.lockedUntil > new Date()) throw tooMany();
        }

        if (ctx.path === '/phone-number/send-otp') {
          const phone = bodyText(ctx.body, 'phoneNumber');
          if (!BR_MOBILE_REGEX.test(phone)) {
            throw new APIError('BAD_REQUEST', { message: 'Celular inválido' });
          }
          const now = Date.now();
          const today = await prisma.otpSendLog.findMany({
            where: { phoneNumber: phone, createdAt: { gte: new Date(now - OTP_DAILY_WINDOW_MS) } },
            orderBy: { createdAt: 'desc' },
            select: { createdAt: true },
          });
          const lastWindow = today.filter((s) => now - s.createdAt.getTime() < OTP_WINDOW_MS);
          if (lastWindow.length >= OTP_MAX_SENDS || today.length >= OTP_DAILY_MAX) throw tooMany();
          if (today[0] && now - today[0].createdAt.getTime() < OTP_RESEND_COOLDOWN_MS)
            throw tooMany();
          await prisma.otpSendLog.create({
            data: { phoneNumber: phone, ip: ctx.request?.headers.get(CLIENT_IP_HEADER) ?? null },
          });
        }
      }),

      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/sign-in/email') return;
        const emailInput = bodyText(ctx.body, 'email').toLowerCase();
        if (!emailInput) return;
        const returned: unknown = ctx.context.returned;
        const failed = isAPIError(returned) && returned.statusCode === 401;
        if (!failed) {
          if (!isAPIError(returned)) {
            await prisma.user.updateMany({
              where: { email: emailInput, failedLoginCount: { gt: 0 } },
              data: { failedLoginCount: 0, lockedUntil: null },
            });
          }
          return;
        }
        // Bloqueio por conta, além do limite por IP (auth-authz.md).
        const user = await prisma.user
          .update({
            where: { email: emailInput },
            data: { failedLoginCount: { increment: 1 } },
            select: { failedLoginCount: true },
          })
          .catch(() => null);
        if (user && user.failedLoginCount >= LOGIN_MAX_FAILURES) {
          await prisma.user.update({
            where: { email: emailInput },
            data: { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOGIN_LOCK_MS) },
          });
        }
      }),
    },

    plugins: [
      phoneNumber({
        otpLength: 4,
        expiresIn: 5 * 60,
        allowedAttempts: 3,
        phoneNumberValidator: (value) => BR_MOBILE_REGEX.test(value),
        sendOTP: ({ phoneNumber: to, code }) => {
          void whatsapp.send({
            to,
            text: `Seu código belezaOur é ${code}. Ele vale por 5 minutos. Não compartilhe com ninguém.`,
          });
        },
        signUpOnVerification: {
          getTempEmail: (value) => `${value.replace(/\D/g, '')}@${PHONE_EMAIL_DOMAIN}`,
          getTempName: () => 'Cliente',
        },
      }),
      twoFactor({
        issuer: 'belezaOur',
        accountLockout: { enabled: true, maxFailedAttempts: 5, durationSeconds: 15 * 60 },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
