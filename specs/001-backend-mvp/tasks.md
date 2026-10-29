---

description: "Task list for Backend MVP do belezaOur"
---

# Tasks: Backend MVP do belezaOur

**Input**: Design documents from `/specs/001-backend-mvp/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api.md, quickstart.md

**Tests**: incluídos — SC-001 (concorrência), SC-002 (isolamento) e o fluxo `/test` do workspace exigem
evidência automatizada. Unitários em `src/**/*.spec.ts`; integração em `test/*.e2e-spec.ts` contra
Postgres real.

**Organization**: por user story (spec.md), em ordem de prioridade.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup (Shared Infrastructure)

- [X] T001 Criar `package.json`, `tsconfig.json`, `tsconfig.build.json`, `nest-cli.json`, `eslint.config.mjs`, `.prettierrc` com NestJS 11, Prisma 7.10, Better Auth 1.6.33, nestjs-zod 5, Zod 4 e demais dependências do plan
- [X] T002 [P] Criar `docker-compose.yml` com Postgres 16 (dev `belezaour` e teste `belezaour_test`, porta 5433, usuário não-superusuário da aplicação) e `docker/init-db.sql`
- [X] T003 [P] Criar `.env.example` só com placeholders (DATABASE_URL, BETTER_AUTH_SECRET, BETTER_AUTH_URL, FRONTEND_URL, CORS_ORIGINS, RESEND_API_KEY, EMAIL_FROM, CLOUDINARY_URL, ADMIN_EMAIL, ADMIN_PASSWORD, SWAGGER_ENABLED, TRUST_PROXY_HOPS, PORT)
- [X] T004 [P] Criar `prisma.config.ts` e configurar scripts npm (`start:dev`, `build`, `lint`, `test`, `test:e2e`, `seed`, `prisma:migrate`)

---

## Phase 2: Foundational (Blocking Prerequisites)

- [X] T005 Modelar `prisma/schema.prisma` completo conforme data-model.md (auth, plataforma, estabelecimento, agenda, reputação, notificações, auditoria)
- [X] T006 Gerar migration inicial e anexar SQL manual (`btree_gist` + exclusion constraint `appointments_no_overlap`) em `prisma/migrations/*_init/migration.sql`
- [X] T007 [P] Implementar validação de ambiente com Zod em `src/config/env.ts`
- [X] T008 [P] Implementar `PrismaService`/`PrismaModule` com adapter-pg em `src/prisma/`
- [X] T009 [P] Implementar utilitários em `src/common/utils/` (`mask.ts`, `slug.ts`, `text.ts` normalização sem acento, `time.ts` fuso SP, `image.ts` magic bytes, `pagination.ts`)
- [X] T010 [P] Testes unitários dos utilitários em `src/common/utils/*.spec.ts`
- [X] T011 Implementar filtro global de erros com mapeamento Prisma/Postgres em `src/common/filters/http-exception.filter.ts` e `src/common/errors.ts` (códigos de domínio)
- [X] T012 [P] Implementar integrações em `src/integrations/` (`email/email.service.ts` Resend, `whatsapp/whatsapp.service.ts` log + outbox de teste, `storage/storage.service.ts` Cloudinary) e `IntegrationsModule`
- [X] T013 Configurar Better Auth em `src/auth/better-auth.ts` (emailAndPassword, emailVerification, phoneNumber, twoFactor, admin, rateLimit, databaseHooks de role, hooks de lockout e limite por telefone)
- [X] T014 Implementar `AuthController` catch-all `/api/auth/*`, `AuthGuard` global (sessão + ban + role + 2FA admin + 8h), `RolesGuard` e decorators (`@Public`, `@Roles`, `@CurrentUser`, `@AllowsMfaEnrollment`) em `src/auth/`
- [X] T015 [P] Implementar `AuditService` em `src/audit/` e `SettingsService` (singleton `global`) em `src/settings/`
- [X] T016 Implementar `src/main.ts` (prefixo `/api`, helmet, CORS allowlist, cookie-parser, trust proxy, Swagger fora de produção com `cleanupOpenApiDoc`) e `src/app.module.ts` (ConfigModule, ThrottlerModule + guard global, ScheduleModule, guards globais, `ZodValidationPipe` global)
- [X] T017 [P] Implementar `HealthController` em `src/health/` e catálogo público (`GET /cities`, `GET /categories`) em `src/catalog/`
- [X] T018 Criar `prisma/seed.ts` (Goiânia, 7 categorias, settings padrão, admin a partir do env) e helpers de teste e2e em `test/` (`jest-e2e.json`, `setup-e2e.ts` reset do banco, `helpers.ts` login de dono/cliente/admin, criação de estabelecimento ativo)

**Checkpoint**: API sobe, `/api/health` responde, auth do Better Auth funcional.

---

## Phase 3: User Story 2 - Dono cadastra e envia para aprovação (Priority: P1)

**Goal**: dono cria conta verificada, monta o estabelecimento e envia para aprovação.

**Independent Test**: `test/owner-onboarding.e2e-spec.ts` — cadastro → verificação → criação → envio → `PENDING` e invisível.

- [X] T019 [P] [US2] Teste e2e de autenticação do dono (cadastro, login bloqueado sem verificação, verificação, reset de senha revoga sessões, role definida no servidor) em `test/auth.e2e-spec.ts`
- [X] T020 [P] [US2] Teste e2e de onboarding em `test/owner-onboarding.e2e-spec.ts`
- [X] T021 [US2] Implementar `OwnerBusinessGuard` + decorators `@OwnerBusiness()` e `@ActiveBusinessRequired()` em `src/businesses/owner-business.guard.ts`
- [X] T022 [US2] Implementar `BusinessesService` (criar, editar, slug único, searchText, horários, envio com validação de completude, transições de status) em `src/businesses/businesses.service.ts`
- [X] T023 [US2] Implementar upload de capa/logo (multer memória 5 MB, magic bytes, Cloudinary) em `src/businesses/business-images.service.ts`
- [X] T024 [US2] Implementar `OwnerBusinessController` (`/owner/business`, `/hours`, `/cover`, `/logo`, `/submit`) com schemas Zod em `src/businesses/`
- [X] T025 [P] [US2] Implementar `ServicesService` + `OwnerServicesController` (CRUD, excluir só sem agendamentos, minPriceCents/searchText) em `src/services/`
- [X] T026 [P] [US2] Implementar `ProfessionalsService` + `OwnerProfessionalsController` (CRUD, vínculo a serviços do mesmo estabelecimento, limite global de ativas) em `src/professionals/`

**Checkpoint**: US2 testável isoladamente.

---

## Phase 4: User Story 3 - Admin aprova, recusa, suspende (Priority: P1)

**Goal**: moderação auditada com admin protegido por 2FA.

**Independent Test**: `test/admin.e2e-spec.ts`.

- [X] T027 [P] [US3] Teste e2e (admin sem 2FA → `MFA_ENROLLMENT_REQUIRED`; habilita TOTP; aprova/recusa com motivo/suspende/reativa; auditoria; não-admin → 403) em `test/admin.e2e-spec.ts`
- [X] T028 [US3] Implementar `AdminBusinessesService` + controller (lista, detalhe, approve, reject, suspend, reactivate, featured, agenda leitura) com auditoria e notificação ao dono em `src/admin/businesses/`

---

## Phase 5: User Story 1 - Cliente agenda horário livre (Priority: P1) 🎯 MVP

**Goal**: disponibilidade correta e reserva sem duplicidade.

**Independent Test**: `test/booking.e2e-spec.ts` e `test/booking-concurrency.e2e-spec.ts`.

- [X] T029 [P] [US1] Testes unitários do motor de disponibilidade (expediente, almoço, bloqueio, sobreposição, fechamento, passado, granularidade, sem preferência) em `src/availability/availability.engine.spec.ts`
- [X] T030 [P] [US1] Teste e2e de reserva (login por código, PHONE_NOT_VERIFIED, preço congelado, SLOT_UNAVAILABLE, status por requiresConfirmation) em `test/booking.e2e-spec.ts`
- [X] T031 [P] [US1] Teste e2e de concorrência (50 reservas paralelas → 1 criada) em `test/booking-concurrency.e2e-spec.ts`
- [X] T032 [US1] Implementar motor puro `computeSlots` em `src/availability/availability.engine.ts`
- [X] T033 [US1] Implementar `AvailabilityService` (carregar dados do dia, slots por serviço/profissional/qualquer, próximo horário livre, "tem horário hoje") em `src/availability/availability.service.ts`
- [X] T034 [US1] Implementar `AppointmentsService.createFromApp` (transação, `FOR UPDATE` na profissional, revalidação, escolha em "sem preferência", snapshot, 23P01→SLOT_TAKEN) em `src/appointments/appointments.service.ts`
- [X] T035 [US1] Implementar `ClientAppointmentsController` `POST /appointments` e disponibilidade pública `GET /businesses/:slug/availability` em `src/appointments/` e `src/marketplace/`

---

## Phase 6: User Story 4 - Dono opera a agenda (Priority: P1)

**Goal**: agenda, transições, balcão, bloqueios, visão geral, clientes.

**Independent Test**: `test/owner-agenda.e2e-spec.ts` e `test/tenant-isolation.e2e-spec.ts`.

- [X] T036 [P] [US4] Testes unitários das transições de status em `src/appointments/appointment-transitions.spec.ts`
- [X] T037 [P] [US4] Teste e2e de agenda (transições, balcão, bloqueio com conflitos, BUSINESS_NOT_ACTIVE) em `test/owner-agenda.e2e-spec.ts`
- [X] T038 [P] [US4] Teste e2e de isolamento entre estabelecimentos (todas as rotas `/owner/*` com IDs alheios → 404) em `test/tenant-isolation.e2e-spec.ts`
- [X] T039 [US4] Implementar regras de transição em `src/appointments/appointment-transitions.ts` e ações do dono no `AppointmentsService`
- [X] T040 [US4] Implementar balcão (`createFromCounter`, cliente por telefone) no `AppointmentsService`
- [X] T041 [US4] Implementar `OwnerAppointmentsController` (detalhe, balcão, transições, agenda, overview, availability, clients) em `src/appointments/owner-appointments.controller.ts` e `src/appointments/owner-agenda.service.ts`
- [X] T042 [US4] Implementar `BlocksService` + `OwnerBlocksController` em `src/blocks/`

---

## Phase 7: User Story 5 - Cliente acompanha, remarca, cancela, avalia (Priority: P2)

**Independent Test**: `test/client-appointments.e2e-spec.ts`.

- [X] T043 [P] [US5] Teste e2e (listas, remarcar, cancelar dentro/fora do prazo, avaliar uma vez, IDs de outra cliente → 404) em `test/client-appointments.e2e-spec.ts`
- [X] T044 [US5] Implementar listagem/detalhe/remarcação/cancelamento da cliente no `AppointmentsService` e `MyAppointmentsController` em `src/appointments/my-appointments.controller.ts`
- [X] T045 [US5] Implementar `ReviewsService` (uma por agendamento concluído, recálculo de nota em transação) em `src/reviews/`

---

## Phase 8: User Story 6 - Descoberta (Priority: P2)

**Independent Test**: `test/marketplace.e2e-spec.ts`.

- [X] T046 [P] [US6] Teste e2e (só ativos de cidade ativa, busca sem acento, filtros, ordenação, slug inativo → 404, destaques, favoritos idempotentes) em `test/marketplace.e2e-spec.ts`
- [X] T047 [US6] Implementar `MarketplaceService` + `MarketplaceController` (busca, perfil por slug, avaliações públicas, destaques) em `src/marketplace/`
- [X] T048 [US6] Implementar `FavoritesService` + controller em `src/favorites/`

---

## Phase 9: User Story 7 - Notificações e lembretes (Priority: P2)

**Independent Test**: `test/notifications.e2e-spec.ts`.

- [X] T049 [P] [US7] Teste e2e (notificação por evento, contagem/leitura, lembrete enviado uma vez, falha externa não desfaz) em `test/notifications.e2e-spec.ts`
- [X] T050 [US7] Implementar `NotificationsService` (in-app + dispatch WhatsApp/e-mail após commit, mensagens por evento) e `MyNotificationsController` em `src/notifications/`
- [X] T051 [US7] Implementar `NotificationsScheduler` (lembretes 24h/2h, convite para avaliar, reivindicação atômica) em `src/notifications/notifications.scheduler.ts`
- [X] T052 [US7] Conectar disparos de notificação a reservas, transições, cancelamentos, remarcações e decisões de cadastro

---

## Phase 10: User Story 8 - Administração e LGPD (Priority: P3)

**Independent Test**: `test/admin-platform.e2e-spec.ts` e `test/lgpd.e2e-spec.ts`.

- [X] T053 [P] [US8] Teste e2e (bloquear encerra sessões, admin não bloqueável, categorias/cidades, settings refletem no prazo, dashboard) em `test/admin-platform.e2e-spec.ts`
- [X] T054 [P] [US8] Teste e2e LGPD (exportação, exclusão anonimiza e preserva agendamentos) em `test/lgpd.e2e-spec.ts`
- [X] T055 [US8] Implementar `AdminUsersController/Service` (lista + contagens, block/unblock com revogação de sessões) em `src/admin/users/`
- [X] T056 [US8] Implementar categorias, cidades, settings e auditoria do admin em `src/admin/catalog/`, `src/admin/settings/`, `src/admin/audit/`
- [X] T057 [US8] Implementar `AdminDashboardService` (KPIs por cidade/período) em `src/admin/dashboard/`
- [X] T058 [US8] Implementar `MeController/MeService` (perfil, consentimento, exportação, exclusão) em `src/me/`

---

## Phase 11: Polish & Cross-Cutting Concerns

- [X] T059 [P] Escrever `README.md` do backend (setup, variáveis, scripts, arquitetura) substituindo o README do template
- [X] T060 Rodar `npm run lint`, `npm run build`, `npm test`, `npm run test:e2e` e corrigir falhas
- [X] T061 Validar cenários do `quickstart.md` e `npm audit --omit=dev`

---

## Dependencies & Execution Order

- Setup (T001–T004) → Foundational (T005–T018) bloqueia tudo.
- US2 (cadastro) antes de US3 (moderação) e de US1/US4 (precisam de estabelecimento ativo; os testes usam helper que cria estabelecimento ativo direto no banco).
- US1 → US4 → US5 (compartilham `AppointmentsService`).
- US6 depende de US1 (disponibilidade). US7 conecta-se a US1–US4. US8 independente após Foundational.

### Parallel Opportunities

- T002/T003/T004; T007/T008/T009/T012/T015/T017; testes `[P]` de cada story antes da implementação;
  T025/T026 (módulos distintos).

## Implementation Strategy

MVP mínimo = Setup + Foundational + US2 + US3 + US1 (cadastro, aprovação, reserva). Em seguida US4
(operação), depois US5–US7 e por fim US8. Cada checkpoint roda `npm run test:e2e` da story.
