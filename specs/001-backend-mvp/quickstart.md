# Quickstart: Backend MVP do belezaOur

## Pré-requisitos

- Node.js 24, npm 11, Docker Desktop.
- Cópia do `.env.example` para `.env` com valores locais (nunca commitar `.env`).

## Subir e preparar

```bash
docker compose up -d db            # Postgres 16 em localhost:5433 (dev) e banco de teste
npm install
npx prisma migrate dev             # aplica migrations, incluindo a exclusion constraint
npm run seed                       # Goiânia, categorias, settings e admin (ADMIN_EMAIL/ADMIN_PASSWORD do .env)
npm run start:dev                  # http://localhost:3333/api, Swagger em /api/docs
```

## Validar

```bash
npm run lint
npm run build
npm test                           # unitários (motor de disponibilidade, transições, utils)
npm run test:e2e                   # integração com Postgres real (banco belezaour_test)
```

## Cenários que provam a feature

| Cenário | Onde | Resultado esperado |
|---|---|---|
| Dono cria conta, verifica e-mail, cadastra e envia | `test/owner-onboarding.e2e-spec.ts` | estabelecimento `PENDING`, invisível na busca |
| Admin sem 2FA bloqueado; com 2FA aprova | `test/admin.e2e-spec.ts` | `MFA_ENROLLMENT_REQUIRED`; depois `ACTIVE` + auditoria |
| Cliente entra por código e agenda | `test/booking.e2e-spec.ts` | 201 com preço/duração congelados |
| 50 reservas simultâneas no mesmo horário | `test/booking-concurrency.e2e-spec.ts` | 1×201, 49×409 `SLOT_TAKEN` |
| Dono acessa recurso de outro estabelecimento | `test/tenant-isolation.e2e-spec.ts` | 404 em todas as rotas |
| Cancelamento fora do prazo | `test/booking.e2e-spec.ts` | 422 `CANCELLATION_WINDOW_CLOSED` |
| Bloqueio remove horários | `test/owner-agenda.e2e-spec.ts` | horários do período somem da disponibilidade |

Contratos em [contracts/api.md](./contracts/api.md); entidades em [data-model.md](./data-model.md).
