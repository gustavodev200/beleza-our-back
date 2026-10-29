# Code Review: Backend MVP do belezaOur

- **Spec**: `spec.md` | **Plan**: `plan.md` | **Security Review**: `security-review.md`
- **Status**: Aprovado
- **Data**: 2026-10-29 · **Verificações**: `npm run lint` ✓ · `npm run build` ✓ · `npm test` 23/23 ✓ ·
  `npm run test:e2e` 66/66 ✓ · `npm audit --omit=dev` 2 LOW (aceitos)

## Achados

| Arquivo:Linha | Severidade | Problema | Correção |
|---|---|---|---|
| `src/marketplace/marketplace.service.ts` (`profile`, cálculo de `openNow`) | média | Dia da semana obtido convertendo `toLocaleString` de volta em `Date`, que depende do fuso do servidor e do formato do locale — "aberto agora" podia errar perto da meia-noite | **Corrigido**: `weekdayOf(localDateOf(now))`, os mesmos utilitários de fuso usados no resto do código |
| `src/appointments/appointment-transitions.ts` | baixa | `ACTIVE_STATUSES` exportado e nunca usado | **Corrigido**: removido |
| `specs/001-backend-mvp/contracts/api.md` | baixa | Contrato dizia paginação máx. 50 para todas as listas, mas a busca pública passou a ter máx. 20 (SR-4) | **Corrigido** |
| `prisma/schema.prisma` (`User.banExpires`, `Session.impersonatedBy`) | baixa | Colunas herdadas do plugin `admin`, descartado no plano — não são lidas nem escritas | **Follow-up**: remover numa migration futura (envolve `DROP COLUMN`; não executado sem sua confirmação) |
| `src/admin/admin-dashboard.ts` (`dashboard`) | baixa | Carrega todos os agendamentos do período em memória para agrupar (até 1 ano) | **Follow-up**: trocar por `groupBy`/SQL agregado quando o volume crescer; aceitável no piloto |
| `src/marketplace/marketplace.service.ts` (`toCards`), `availability.service.ts` (`nextFreeSlots`) | baixa | N+1 consciente: cada card calcula próximos horários com algumas queries | Limitado por pageSize ≤ 20 e teto de 100 candidatos (SR-4). **Follow-up**: cache curto por estabelecimento se a escala crescer |
| `src/appointments/appointments.service.ts` (`findOrCreateCounterClient`) | baixa | Dois balcões simultâneos para o mesmo telefone novo: o segundo recebe 409 genérico (unique de `phone_number`) | Aceitável (repetir resolve); sem perda de dado |
| vários `*.schemas.ts` | baixa | `z.string().uuid()/.url()/.email()/.datetime()` estão deprecados no Zod 4 (funcionam) | **Follow-up** de estilo: migrar para `z.uuid()`, `z.url()`, `z.email()`, `z.iso.datetime()` |

## Correção frente à spec

- FR-001…FR-085 implementados; cada user story tem teste e2e independente (ver `tasks.md`).
- Desvios conscientes, registrados em `research.md`: consentimento de WhatsApp coletado no primeiro
  agendamento e em `PATCH /me` (R11), limite de envios de código por IP = 10/10 min (salões
  compartilham Wi-Fi), teto diário extra por telefone (SR-1), status `DRAFT` antes do envio.
- Clarificações (`spec.md` → Clarifications) verificadas no código: só plano Free, código obrigatório
  para agendar, `requiresConfirmation`, limite global de profissionais, TOTP, grade de 15 min,
  remarcação no mesmo agendamento, exclusão de serviço só sem histórico.

## Simplicidade e consistência

- Sem repository pattern, CQRS, filas ou Redis; controllers finos, regra nos services (skill `backend/nestjs`).
- Preset `prisma-postgres` respeitado; nada de Supabase. Prisma via `PrismaService` singleton com adapter.
- Uma única regra de disponibilidade (`computeSlots`) para listar e para reservar (Princípio IX).

## Confirmação de itens da Security Review

- [x] Nenhum item "Pendente" sem decisão: CI/Dependabot ausente e os demais riscos estão em "Riscos
      aceitos explicitamente" — aceitos pelo agente sob delegação; **revisão do usuário recomendada**.

## Confirmação de escopo

- [x] Implementação cobre todos os requisitos funcionais de `spec.md`.
- [x] Nada fora do escopo: sem pagamentos, sem planos pagos, sem frontend.
- [x] Testes de `tasks.md` existem e passam (23 unitários + 66 e2e, incluindo SC-001 e SC-002).

## Conclusão

**Aprovado.** Pendências não bloqueantes: follow-ups da tabela acima e as decisões de produto da
Security Review (código de 6 dígitos, CI com auditoria de dependências).
