# API Contract: Backend MVP do belezaOur

Base: `/api`. Contrato executável: Swagger em `/api/docs` (somente fora de produção).
Erros: `{ statusCode, code?, message, path, timestamp }`. Paginação: `?page=1&pageSize=20` (máx. 50; na busca pública `GET /businesses` o padrão é 12 e o máximo 20),
resposta `{ items, page, pageSize, total }`. Datas ISO-8601 UTC; `date` em `YYYY-MM-DD` (calendário SP).
Legenda de acesso: **P** público · **C** CLIENT · **O** BUSINESS_OWNER · **A** SUPER_ADMIN (com 2FA).

## Autenticação (Better Auth, `/api/auth/*`)

| Método | Rota | Acesso | Uso |
|---|---|---|---|
| POST | `/auth/sign-up/email` | P | Dono cria conta `{ name, email, password }` → e-mail de verificação |
| POST | `/auth/sign-in/email` | P | Dono/admin entram; admin com 2FA recebe `twoFactorRedirect` |
| POST | `/auth/send-verification-email` | P | Reenvio do link |
| GET | `/auth/verify-email?token=` | P | Confirma e-mail |
| POST | `/auth/request-password-reset` | P | `{ email, redirectTo }` (resposta idêntica sempre) |
| POST | `/auth/reset-password` | P | `{ token, newPassword }` |
| POST | `/auth/phone-number/send-otp` | P | `{ phoneNumber }` (E.164 BR) |
| POST | `/auth/phone-number/verify` | P | `{ phoneNumber, code }` → sessão da cliente |
| POST | `/auth/two-factor/enable` · `/verify-totp` · `/get-totp-uri` | A | Cadastro/uso do TOTP |
| POST | `/auth/sign-out` · GET `/auth/get-session` | logado | |

## Público

| Método | Rota | Descrição |
|---|---|---|
| GET | `/health` | `{ status: 'ok' }` |
| GET | `/cities` | Cidades ativas |
| GET | `/categories` | Categorias visíveis, ordenadas |
| GET | `/businesses` | Busca: `q, cityId, categoryId, neighborhood, availableToday, sort(relevance\|distance\|rating\|price), lat, lng` + paginação |
| GET | `/businesses/featured` | Destaques com até 3 próximos horários |
| GET | `/businesses/:slug` | Perfil público (serviços visíveis, profissionais ativas, horários, nota, aberto agora, próximo horário) |
| GET | `/businesses/:slug/reviews` | Avaliações paginadas |
| GET | `/businesses/:slug/availability` | `serviceId, date, professionalId?` → `{ date, slots: [{ startsAt, professionalIds }] }` |

## Cliente (`C`)

| Método | Rota | Descrição |
|---|---|---|
| GET/PATCH | `/me` | Perfil (`name`, `whatsappConsent`) |
| GET | `/me/export` | Exportação LGPD (JSON) |
| DELETE | `/me` | Exclusão/anonimização (`C` e `O`) |
| POST | `/appointments` | `{ businessId, serviceId, professionalId?, startsAt, notes?, clientName, whatsappConsent: true }` → 201 / 409 `SLOT_TAKEN` |
| GET | `/me/appointments?scope=upcoming\|history` | Lista paginada |
| GET | `/me/appointments/:id` | Detalhe |
| PATCH | `/me/appointments/:id/reschedule` | `{ startsAt, professionalId? }` |
| POST | `/me/appointments/:id/cancel` | Respeita prazo global |
| POST | `/me/appointments/:id/review` | `{ rating, tags[], comment? }` |
| GET | `/me/favorites` · PUT/DELETE `/me/favorites/:businessId` | Favoritos |
| GET | `/me/notifications` · `/me/notifications/unread-count` · POST `/me/notifications/read` `{ ids? }` | Notificações (`C`, `O`, `A`) |

## Dono (`O`, estabelecimento resolvido pela sessão)

| Método | Rota | Descrição |
|---|---|---|
| GET/POST/PATCH | `/owner/business` | Ver/criar/editar (tipo, nome, contato, cidade, bairro, endereço, coords, descrição, categorias, requiresConfirmation) |
| PUT | `/owner/business/hours` | Substitui grade semanal |
| POST | `/owner/business/cover` · `/owner/business/logo` | `multipart/form-data` campo `file` |
| POST | `/owner/business/submit` | `DRAFT\|REJECTED → PENDING` |
| GET/POST | `/owner/services` · PATCH/DELETE `/owner/services/:id` | Serviços |
| GET/POST | `/owner/professionals` · PATCH `/owner/professionals/:id` | Profissionais (`active`, `serviceIds`) |
| GET | `/owner/overview?date=` | Cards do dia + agenda do dia + novos/pendentes |
| GET | `/owner/agenda?from=&to=&professionalIds=` | Agendamentos + bloqueios + horários (≤ 14 dias) |
| GET | `/owner/availability` | Igual à pública, para o próprio estabelecimento |
| GET | `/owner/appointments/:id` | Detalhe (gaveta) |
| POST | `/owner/appointments` | Balcão `{ clientName, clientPhone, serviceId, professionalId, startsAt, notes? }` |
| POST | `/owner/appointments/:id/{confirm\|complete\|cancel\|no-show\|reopen}` | Transições |
| GET/POST | `/owner/blocks` · DELETE `/owner/blocks/:id` | Bloqueios (POST retorna `{ block, conflicts[] }`) |
| GET | `/owner/clients` | Clientes que agendaram (paginado) |

## Admin (`A`)

| Método | Rota | Descrição |
|---|---|---|
| GET | `/admin/dashboard?cityId=&from=&to=` | KPIs, série diária, por categoria, ranking, fila |
| GET | `/admin/businesses?status=&q=` · GET `/admin/businesses/:id` | Lista e detalhe completo |
| POST | `/admin/businesses/:id/{approve\|reject\|suspend\|reactivate}` | `reject` exige `{ reason }` |
| PATCH | `/admin/businesses/:id/featured` | `{ featured }` |
| GET | `/admin/businesses/:id/agenda?from=&to=` | Leitura |
| GET | `/admin/users?role=&q=` · POST `/admin/users/:id/{block\|unblock}` | Usuários (+ contagens por role) |
| GET/POST | `/admin/categories` · PATCH `/admin/categories/:id` · PUT `/admin/categories/order` | Categorias |
| GET/POST | `/admin/cities` · PATCH `/admin/cities/:id` | Cidades |
| GET/PATCH | `/admin/settings` | Configurações globais |
| GET | `/admin/audit-logs` | Auditoria paginada |

## Códigos de erro de domínio

`SLOT_TAKEN` (409), `SLOT_UNAVAILABLE` (422), `CANCELLATION_WINDOW_CLOSED` (422), `INVALID_TRANSITION` (422),
`BUSINESS_NOT_ACTIVE` (403), `BUSINESS_INCOMPLETE` (422), `PROFESSIONAL_LIMIT_REACHED` (422),
`PHONE_NOT_VERIFIED` (403), `ALREADY_REVIEWED` (409), `ACCOUNT_BLOCKED` (403),
`MFA_ENROLLMENT_REQUIRED` (403), `ADMIN_SESSION_EXPIRED` (401), `INVALID_IMAGE` (422).
