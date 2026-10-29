# Research: Backend MVP do belezaOur

Fontes: Context7 (`/better-auth/better-auth`, `/cloudinary/cloudinary_npm`), registro npm (2026-10-29),
implementação de referência em `E:\projetos\meualuguel\aluga-web-back-api` (mesma stack em produção).

## R1 — Versão do NestJS

- **Decision**: NestJS 11.x (11.2.8).
- **Rationale**: `nestjs-zod@5.5` declara peer `@nestjs/common ^10 || ^11`; meualuguel roda Nest 11 em produção.
- **Alternatives**: Nest 12.3 (mais novo, mas quebra o peer do nestjs-zod).

## R2 — Better Auth em NestJS

- **Decision**: Better Auth 1.7.14 (atualizado de 1.6.33 após `npm audit` apontar advisories da linha 1.6), montado por controller catch-all `@All('*path')` com `toNodeHandler(auth)`
  em `/api/auth`; sessão lida no guard com `auth.api.getSession({ headers: fromNodeHeaders(...) })`.
- **Rationale**: padrão testado no meualuguel; evita dependência da lib de comunidade `@thallesp/nestjs-better-auth`.
- **Alternatives**: `@thallesp/nestjs-better-auth` (guard global próprio; menos controle sobre ban/2FA/8h).
- Plugins: `phoneNumber` (`otpLength: 4`, `expiresIn: 300`, `allowedAttempts: 3`, `signUpOnVerification`),
  `twoFactor` (TOTP, `accountLockout`). Plugin `admin` **descartado**: expõe rotas `/admin/*` próprias que contornariam a auditoria; `role` e `banned` viram `additionalFields` com `input: false` e o bloqueio é aplicado num hook de criação de sessão.
- E-mail: `requireEmailVerification: true`, `sendOnSignUp: true`, `autoSignInAfterVerification: true`,
  `sendResetPassword`, `resetPasswordTokenExpiresIn: 1800`, `revokeSessionsOnPasswordReset: true`;
  envio sem `await` (recomendação da doc contra timing attack).
- Sessão: `expiresIn: 30d`, `updateAge: 1d`, `cookieCache` 60 s (revogação efetiva em ≤ 60 s, igual meualuguel).
- Rate limit: `rateLimit.enabled: true` (também em dev), `customRules` por rota.

## R3 — Prisma 7

- **Decision**: Prisma 7.10.1 com `prisma.config.ts`, `@prisma/adapter-pg` e generator `prisma-client-js`.
- **Rationale**: Prisma 7 exige adapter de driver; configuração idêntica à do meualuguel.

## R4 — Conflito de horário

- **Decision**: `CREATE EXTENSION btree_gist` + `EXCLUDE USING gist (professional_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&) WHERE (status IN ('PENDING','CONFIRMED'))`.
- **Rationale**: única garantia real contra corrida; `[)` permite horários encostados (10:00–11:00 e 11:00–12:00).
- **Alternatives**: `SERIALIZABLE` puro (retries frequentes, não cobre todos os caminhos), advisory lock (garantia só por convenção).

## R5 — Validação

- **Decision**: `nestjs-zod` (`createZodDto`, `ZodValidationPipe` global, `cleanupOpenApiDoc` no Swagger) com schemas `.strict()`.
- **Rationale**: Princípio II exige Zod; integração com Swagger evita DTO duplicado.

## R6 — Imagens

- **Decision**: Cloudinary SDK v2, `upload_stream` a partir do buffer, `public_id` `{env}/businesses/{id}/{cover|logo}`,
  `overwrite: true`, `invalidate: true`, `allowed_formats: ['jpg','png','webp']`, transformação na entrada
  (`crop: 'fill'`, 1600×600 / 512×512, `quality: 'auto'`).
- **Magic bytes**: verificação manual (JPEG `FF D8 FF`, PNG `89 50 4E 47 0D 0A 1A 0A`, WebP `RIFF....WEBP`).
  `file-type` descartado: é ESM-only e complica o build CommonJS/Jest.

## R7 — Fuso e calendário

- **Decision**: `date-fns` 4 + `@date-fns/tz` (`TZDate`) com `America/Sao_Paulo`; instantes UTC no banco.
- **Rationale**: Brasil sem horário de verão desde 2019, mas a lib evita aritmética manual de offset.

## R8 — Logs

- **Decision**: Logger nativo do Nest; nunca logar body/headers; util `mask()` para telefone/e-mail.
- **Alternatives**: `nestjs-pino` com redaction (YAGNI para instância única).

## R9 — Agendador

- **Decision**: `@nestjs/schedule` em processo, cron a cada 5 min; reivindicação atômica por `updateMany`.
- **Rationale**: instância única; sem Redis/filas (XII).

## R10 — WhatsApp

- **Decision**: interface `WhatsappSender` com implementação `LogWhatsappSender` (registra mensagem com telefone mascarado; em `test` guarda em memória para os testes lerem o código).
- **Rationale**: provedor não contratado; substituível sem tocar regras.

## R11 — Consentimento de WhatsApp (ajuste ao FR-070)

- **Decision**: o consentimento é registrado no primeiro agendamento (`whatsappConsent: true` obrigatório no body) e editável em `PATCH /api/me`.
- **Rationale**: o endpoint de envio de código pertence ao Better Auth e não aceita campos extras; o envio do código em si é solicitado pela própria cliente.
