# Data Model: Backend MVP do belezaOur

Convenções: IDs `String` (Better Auth gera os das tabelas dele; demais `uuid()`); tabelas/colunas em
`snake_case` via `@@map`/`@map`; instantes `timestamptz` (UTC); dinheiro em centavos (`Int`);
`createdAt`/`updatedAt` em entidades de negócio. Fonte executável: `prisma/schema.prisma`.

## Autenticação (gerenciadas pelo Better Auth)

| Entidade | Campos principais | Notas |
|---|---|---|
| **User** | id, name, email (único), emailVerified, image, phoneNumber (único), phoneNumberVerified, role (`CLIENT`\|`BUSINESS_OWNER`\|`SUPER_ADMIN`), banned, banReason, banExpires, twoFactorEnabled, whatsappConsentAt, failedLoginCount, lockedUntil, anonymizedAt | Cliente por telefone recebe e-mail temporário interno `{telefone}@phone.belezaour.local` (exigência do plugin); nunca exibido |
| **Session** | id, token (único), userId, expiresAt, ipAddress, userAgent, impersonatedBy | Revogada no ban, reset de senha, exclusão de conta |
| **Account** | id, userId, providerId, accountId, password (hash scrypt) | Hash nunca sai da API |
| **Verification** | id, identifier, value, expiresAt | Links de e-mail, OTP de telefone |
| **TwoFactor** | id, userId, secret, backupCodes | TOTP do admin |
| **OtpSendLog** | id, phoneNumber, ip, createdAt | Limite 3 envios/10 min e 30 s entre envios (índices `phone, createdAt` e `ip, createdAt`) |

## Plataforma

| Entidade | Campos | Regras |
|---|---|---|
| **City** | id, name, state, slug (único), active | Goiânia-GO no seed |
| **Category** | id, name (único), slug (único), icon, sortOrder, visible | 7 do produto no seed |
| **PlatformSetting** | id = `global`, cancellationWindowMinutes (60\|120\|360\|1440, padrão 120), remindersEnabled (true), reviewRequestEnabled (true), maxActiveProfessionals (padrão 2, 1–50) | Linha única |
| **AuditLog** | id, actorId, action, targetType, targetId, summary (Json), ip, createdAt | Índice `createdAt desc` |

## Estabelecimento

| Entidade | Campos | Regras |
|---|---|---|
| **Business** | id, ownerId (único → 1 por dono), cityId, type (`SALON`\|`BARBERSHOP`\|`STUDIO`\|`AUTONOMOUS`\|`AESTHETICS`), name, slug (único), description, whatsapp, phone, neighborhood, address, latitude?, longitude?, coverUrl?, logoUrl?, status, rejectionReason?, submittedAt?, approvedAt?, featured, requiresConfirmation, ratingAvg (Decimal 3,2), ratingCount, minPriceCents?, searchText | Índices: `status, cityId`, `featured`, `neighborhood` |
| **BusinessCategory** | businessId, categoryId (PK composta) | |
| **BusinessHours** | id, businessId, weekday (0–6, domingo=0), opensAt (minutos 0–1439), closesAt, breakStart?, breakEnd? | Único `businessId, weekday`; ausência = fechado; `opensAt < closesAt`; pausa dentro do expediente |
| **Service** | id, businessId, categoryId, name, durationMinutes (5–480, múltiplo de 5), priceCents (0–10.000.000), visible, deletedAt? | Exclusão física só sem agendamentos |
| **Professional** | id, businessId, name, role, photoUrl?, active | |
| **ProfessionalService** | professionalId, serviceId (PK composta) | Só serviços do mesmo estabelecimento |

### Status do estabelecimento

```text
DRAFT ──submit──▶ PENDING ──approve──▶ ACTIVE ◀──reactivate── SUSPENDED
                    │                    └──────suspend──────────▲
                    └──reject(motivo)──▶ REJECTED ──submit──▶ PENDING
```

Visível no marketplace somente `ACTIVE` em cidade `active`. Operação (agenda/agendamentos/bloqueios)
somente `ACTIVE`. Edição de perfil em `DRAFT|PENDING|REJECTED|ACTIVE`.

## Agenda

| Entidade | Campos | Regras |
|---|---|---|
| **Appointment** | id, businessId, clientId, professionalId, serviceId, startsAt, endsAt, priceCents, durationMinutes, serviceName, status, origin (`APP`\|`COUNTER`), notes?, cancelledBy? (`CLIENT`\|`OWNER`), completedAt?, reminder24hSentAt?, reminder2hSentAt?, reviewInviteSentAt?, isNewForOwner | **EXCLUDE** `(professional_id =, tstzrange(starts_at, ends_at,'[)') &&) WHERE status IN ('PENDING','CONFIRMED')`; índices `businessId, startsAt`, `clientId, startsAt`, `professionalId, startsAt` |
| **TimeBlock** | id, businessId, professionalId, startsAt, endsAt, reason (`APPOINTMENT`\|`DAY_OFF`\|`EXTENDED_LUNCH`\|`COURSE`) | Índice `professionalId, startsAt` |

### Status do agendamento

```text
            (app, sem confirmação) ─▶ CONFIRMED
(app, exige confirmação) ─▶ PENDING ──confirm──▶ CONFIRMED
PENDING|CONFIRMED ──cancel(cliente no prazo | dono)──▶ CANCELED
CONFIRMED ──complete (após início)──▶ COMPLETED
CONFIRMED ──no-show (após início)──▶ NO_SHOW
COMPLETED|CANCELED|NO_SHOW ──reopen (dono, horário livre)──▶ CONFIRMED
```

## Reputação e engajamento

| Entidade | Campos | Regras |
|---|---|---|
| **Review** | id, appointmentId (único), businessId, clientId, rating (1–5), tags (enum[]), comment? (≤500) | Só `COMPLETED` do próprio cliente; atualiza `ratingAvg/ratingCount` na mesma transação |
| **Favorite** | clientId, businessId (PK composta), createdAt | Idempotente |
| **Notification** | id, userId, type, title, body, data (Json), readAt?, createdAt | Índice `userId, readAt, createdAt` |

## Disponibilidade (cálculo, não persistido)

Entrada: horário do dia (tz SP), pausa, duração do serviço, profissionais aptas e ativas,
agendamentos `PENDING|CONFIRMED` e bloqueios do dia, `now`. Saída: inícios a cada 15 min em que
`[início, início+duração)` cabe no expediente, não toca pausa/bloqueio/agendamento e `início > now`.
"Sem preferência": o horário é livre se ao menos uma profissional apta estiver livre; na reserva,
escolhe a com menos agendamentos ativos no dia (desempate por id).
