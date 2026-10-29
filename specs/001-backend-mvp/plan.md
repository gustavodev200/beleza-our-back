# Implementation Plan: Backend MVP do belezaOur

**Branch**: `001-backend-mvp` | **Date**: 2026-10-29 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-backend-mvp/spec.md`

## Summary

API REST única (NestJS) que atende os três públicos do belezaOur — cliente, dono do estabelecimento e
admin da plataforma — com autenticação delegada ao Better Auth (e-mail+senha com verificação, telefone
com código, segundo fator do admin), estabelecimento com fluxo de aprovação, motor de disponibilidade
único usado na listagem e na gravação, conflito de agenda impedido por exclusion constraint no
PostgreSQL, notificações in-app/WhatsApp/e-mail após o commit e um painel administrativo auditado.
Somente plano Free; sem gateway de pagamento.

## Technical Context

**Language/Version**: TypeScript 5.x (`strict: true`) sobre Node.js 24

**Primary Dependencies**: NestJS 11.x (`@nestjs/common|core|platform-express|config|swagger|throttler|schedule`),
Prisma 7.10 + `@prisma/adapter-pg`, Better Auth 1.7.14 (plugins `phoneNumber` e `twoFactor`; papel e bloqueio via `additionalFields`),
`nestjs-zod` 5 + Zod 4, Resend, Cloudinary SDK 2, `helmet`, `cookie-parser`, `date-fns` 4 + `@date-fns/tz`,
`multer` (memória)

**Storage**: PostgreSQL 16 (extensão `btree_gist`); imagens no Cloudinary

**Testing**: Jest 30 + ts-jest (unitário: motor de disponibilidade, transições, utilitários) e Jest +
supertest contra Postgres real em Docker (integração/e2e: auth, isolamento, concorrência, regras)

**Target Platform**: Container Linux (Node 24); dev em Windows/Docker Desktop

**Project Type**: web-service (API REST consumida pelo app web/PWA em `../beleza-our-front`)

**Performance Goals**: disponibilidade de 1 dia < 1 s com 10 profissionais (SC-005); 50 reservas
concorrentes sem duplicidade (SC-001)

**Constraints**: instância única; fuso `America/Sao_Paulo`; sem Redis/filas (Princípio XII); efeitos
externos após commit (XI)

**Scale/Scope**: piloto Goiânia — centenas de estabelecimentos, milhares de clientes; ~60 endpoints

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Princípio | Como o plano cumpre | Status |
|---|---|---|
| I Stack declarada | `project.config.json` preset `prisma-postgres`, auth `better-auth`, storage `cloudinary` | ✅ |
| II Zod na borda | `ZodValidationPipe` global (nestjs-zod) + schemas `.strict()`; env validado com Zod no boot; rotas do Better Auth validadas pelo próprio Better Auth | ✅ |
| III Autorização no servidor | `AuthGuard` global relê role/ban do banco; `RolesGuard`; ownership no service | ✅ |
| IV RLS Supabase | Não se aplica (preset Prisma) | N/A |
| V Segurança antes do review | `/security` gera `security-review.md` antes do `/review` | ✅ (fase posterior) |
| VI YAGNI | Sem repository pattern, sem CQRS, sem fila; Nest Logger nativo em vez de pino | ✅ |
| VII Rastreabilidade | `specs/001-backend-mvp/{spec,plan,research,data-model,contracts,quickstart,tasks}` | ✅ |
| VIII Isolamento | `OwnerBusinessGuard` injeta `businessId` da sessão; queries sempre `where: { businessId }`; 404 cruzado | ✅ |
| IX Agenda no banco | Exclusion constraint `btree_gist` + `SELECT … FOR UPDATE` na profissional dentro da transação | ✅ |
| X Tempo e dinheiro | `timestamptz`; `@date-fns/tz` com `America/Sao_Paulo`; `priceCents Int`; snapshot na reserva | ✅ |
| XI Efeitos após commit | `NotificationsService.dispatch()` chamado depois do `$transaction`; erros só logados | ✅ |
| XII Escopo enxuto | Sem planos/pagamento; limite de profissionais é configuração global | ✅ |

Resultado: **PASS** (sem violações; ver Complexity Tracking para duas decisões conscientes).

## Project Structure

### Documentation (this feature)

```text
specs/001-backend-mvp/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── api.md
├── checklists/requirements.md
└── tasks.md            # /speckit-tasks
```

### Source Code (repository root)

```text
prisma/
├── schema.prisma
├── migrations/          # inclui SQL manual da exclusion constraint
└── seed.ts              # cidades, categorias, settings, admin
prisma.config.ts
docker-compose.yml       # postgres dev + test
src/
├── main.ts
├── app.module.ts
├── config/env.ts                    # schema Zod do ambiente
├── prisma/                          # PrismaService (adapter-pg)
├── auth/                            # better-auth.ts, auth.controller (catch-all), guards, decorators, hooks
├── common/                          # filtro de erro, utils (mask, slug, time, text, image), paginação
├── integrations/                    # email (Resend), whatsapp (log), storage (Cloudinary)
├── audit/
├── settings/                        # configurações globais (singleton)
├── catalog/                         # cidades e categorias públicas
├── businesses/                      # onboarding e perfil do dono, horários, imagens, envio
├── services/                        # serviços do estabelecimento
├── professionals/
├── availability/                    # engine puro + service
├── appointments/                    # cliente e dono, transições, balcão
├── blocks/
├── marketplace/                     # busca, perfil público, destaques, avaliações públicas
├── reviews/
├── favorites/
├── notifications/                   # in-app + dispatch + scheduler de lembretes
├── me/                              # perfil, exportação, exclusão
├── admin/                           # dashboard, aprovações, estabelecimentos, usuários, categorias, cidades, settings, auditoria
└── health/
test/
├── jest-e2e.json
├── setup-e2e.ts                     # reset do banco de teste
└── *.e2e-spec.ts
```

**Structure Decision**: projeto único NestJS (Option 1), um módulo por domínio; controllers só HTTP,
services com regra de negócio e acesso ao Prisma (sem camada de repositório).

## Architecture Decisions

1. **Auth**: instância Better Auth criada por factory (`createAuth(prisma, senders)`), montada em
   `/api/auth/*` por controller catch-all com `toNodeHandler` (padrão já validado no meualuguel).
   `AuthGuard` global: obtém a sessão, relê `role`, `banned`, `twoFactorEnabled` do banco; admin sem
   2FA só acessa as rotas de cadastro do 2FA; sessão de admin com mais de 8h é recusada.
2. **Papéis**: `databaseHooks.user.create.before` define `BUSINESS_OWNER` para `/sign-up/email` e
   `CLIENT` para o resto (telefone). `SUPER_ADMIN` só pelo seed. Campo `role` não aceito como input.
3. **Rate limit**: rotas do Better Auth usam o rate limiter do próprio Better Auth (sempre ligado,
   regras por rota); demais rotas `@nestjs/throttler`. Limite por telefone (3 envios/10 min, 30 s) e
   bloqueio por conta (5 falhas → 15 min) em hooks `before/after` do Better Auth.
4. **Disponibilidade**: função pura `computeSlots(input)` (testável sem banco) + service que carrega
   dados em poucas queries; a criação de agendamento chama o mesmo cálculo dentro da transação após
   `SELECT … FOR UPDATE` na profissional; a constraint `appointments_no_overlap` é a garantia final
   (erro `23P01` → `409 SLOT_TAKEN`).
5. **Isolamento**: `OwnerBusinessGuard` resolve `business` por `ownerId = session.user.id` e o anexa
   ao request; decorator `@ActiveBusinessRequired()` para rotas operacionais.
6. **Notificações**: `NotificationsService` grava in-app (fora da transação de negócio) e chama
   `WhatsappSender`/`EmailSender`; `NotificationsScheduler` (`@Cron` a cada 5 min) reivindica
   lembretes com `updateMany … where sentAt IS NULL` para nunca enviar duas vezes.
7. **Busca**: coluna `searchText` normalizada (minúsculas, sem acento) mantida pelo service; filtro com
   `contains`; `minPriceCents` denormalizado; ordenação por distância calculada em memória sobre o
   conjunto filtrado (escala do piloto).
8. **Imagens**: `multer` em memória (limite 5 MB) → verificação de magic bytes (JPEG/PNG/WebP) →
   `upload_stream` do Cloudinary com `public_id` determinístico e transformação na entrada.
9. **Erros**: filtro global devolve `{ statusCode, code?, message, path, timestamp }`; 500 sem detalhe
   em produção; mapeamento Prisma `P2002→409`, `P2025→404`, `23P01→409 SLOT_TAKEN`.

## Complexity Tracking

| Decisão | Por que é necessária | Alternativa mais simples rejeitada porque |
|---|---|---|
| SQL manual na migration (exclusion constraint + `btree_gist`) | Princípio IX exige garantia no banco; Prisma não modela `EXCLUDE` | Validação só na aplicação não impede corrida entre transações |
| Dois rate limiters (Better Auth nas rotas `/api/auth`, throttler no resto) | Rotas do Better Auth são servidas pelo handler dele, fora dos decorators do Nest | Reescrever as rotas de auth em Nest duplicaria lógica do Better Auth |
