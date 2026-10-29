# belezaOur — Backend

API REST do belezaOur, marketplace de agendamento de serviços de beleza (piloto em Goiânia-GO).
Atende três públicos: **cliente** (busca e agenda), **dono do estabelecimento** (painel e agenda) e
**admin da plataforma** (moderação e operação). MVP somente com o plano Free — sem pagamentos.

- Produto: [docs/mvp-spec.md](docs/mvp-spec.md)
- Especificação, plano e tarefas: [specs/001-backend-mvp/](specs/001-backend-mvp/)
- Contrato da API: [specs/001-backend-mvp/contracts/api.md](specs/001-backend-mvp/contracts/api.md) e Swagger em `/api/docs` (fora de produção)
- Princípios de engenharia: [.specify/memory/constitution.md](.specify/memory/constitution.md)

## Stack

NestJS 11 · TypeScript strict · PostgreSQL 16 · Prisma 7 (`@prisma/adapter-pg`) · Better Auth 1.7
(e-mail+senha, telefone com código, TOTP) · Zod (`nestjs-zod`) · Resend · Cloudinary ·
`@nestjs/throttler` · helmet · `@nestjs/schedule` · Jest + supertest.

## Rodando localmente

Pré-requisitos: Node.js 24, Docker Desktop.

```bash
cp .env.example .env               # preencha BETTER_AUTH_SECRET (openssl rand -hex 32) e ADMIN_*
docker compose up -d db            # Postgres em 127.0.0.1:5433 (banco dev + banco de teste)
npm install
npx prisma migrate dev             # aplica migrations (inclui a exclusion constraint da agenda)
npm run seed                       # Goiânia, categorias, configurações e o admin do .env
npm run start:dev                  # http://localhost:3333/api  ·  Swagger: /api/docs
```

Sem `RESEND_API_KEY`/`CLOUDINARY_URL` em desenvolvimento, e-mails só são registrados em log e as
imagens recebem uma URL local. O WhatsApp ainda não tem provedor: as mensagens são registradas com
o telefone mascarado (em `development`, o código de acesso aparece no log de debug para permitir o
login).

O admin entra com e-mail e senha e **precisa ativar o 2FA** (`POST /api/auth/two-factor/enable`)
antes de acessar qualquer rota `/api/admin`.

## Scripts

| Comando | O que faz |
|---|---|
| `npm run start:dev` | API com reload |
| `npm run build` / `npm run start:prod` | Build e execução de produção |
| `npm run lint` | ESLint (type-checked) |
| `npm test` | Testes unitários (`src/**/*.spec.ts`) |
| `npm run test:e2e` | Builda, sobe a API como processo filho contra o banco `belezaour_test` e roda `test/*.e2e-spec.ts` |
| `npm run seed` | Seed idempotente |
| `npm run prisma:deploy` | Aplica migrations em produção (`prisma migrate deploy`) |

Os testes e2e não apagam dados: aplicam migrations pendentes, semeiam de forma idempotente e criam
dados únicos a cada execução.

## Arquitetura

Um módulo NestJS por domínio em `src/`. Controllers cuidam de HTTP; services têm a regra de negócio
e falam com o Prisma (sem camada de repositório).

| Módulo | Responsabilidade |
|---|---|
| `auth/` | Better Auth em `/api/auth/*`, `AuthGuard` global (relê papel, bloqueio e 2FA do banco a cada requisição), `RolesGuard` |
| `businesses/`, `services/`, `professionals/` | Onboarding e cadastro do dono; `OwnerBusinessGuard` resolve o estabelecimento **pela sessão** |
| `availability/` | Motor puro de horários (`availability.engine.ts`) + carga dos dados do dia |
| `appointments/`, `blocks/` | Reserva (app e balcão), transições, remarcação, cancelamento, agenda, bloqueios |
| `marketplace/`, `favorites/`, `reviews/` | Busca pública, perfil por slug, destaques, favoritos, avaliações |
| `notifications/` | In-app + WhatsApp + e-mail após o commit; agendador de lembretes e convites |
| `admin/` | Moderação, usuários, catálogo, configurações, auditoria, dashboard |
| `me/` | Perfil, consentimento de WhatsApp, exportação e exclusão (LGPD) |

### Garantias importantes

- **Sem reserva dupla**: exclusion constraint `appointments_no_overlap` (`btree_gist` + `tstzrange`) e
  trava `FOR UPDATE` nas profissionais dentro da transação. Teste: 50 reservas simultâneas → 1.
- **Isolamento por estabelecimento**: `businessId` nunca vem do cliente; recurso alheio responde 404.
- **Tempo e dinheiro**: instantes em UTC, calendário em `America/Sao_Paulo`, valores em centavos,
  preço e duração congelados na reserva.
- **Efeitos externos após o commit**: falha de WhatsApp/e-mail é registrada e não desfaz a operação.

## Segurança

Checklist e processo em [SECURITY.md](SECURITY.md) e `.claude/skills/security/`. Resumo do que o
backend aplica: validação Zod estrita em toda entrada, papéis definidos pelo servidor, sessões no
banco (revogação imediata), bloqueio por conta após 5 senhas erradas, limite de envio de código por
telefone e por IP, 2FA obrigatório e sessão de 8h para admin, rate limit, helmet, CORS por allowlist,
erros sem detalhes internos, logs sem dados sensíveis, Swagger desligado em produção, upload validado
pelo conteúdo e auditoria de toda ação administrativa.

## Variáveis de ambiente

Ver [.env.example](.env.example). Em produção, `RESEND_API_KEY` e `CLOUDINARY_URL` são obrigatórios e
`SWAGGER_ENABLED` precisa ser `false` (a API não sobe caso contrário). Defina `TRUST_PROXY_HOPS` com o
número de proxies reversos à frente da API.
