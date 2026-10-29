# Security Review: Backend MVP do belezaOur

- **Plan relacionado**: `plan.md`
- **Status**: Aprovado com ressalvas
- **Data**: 2026-10-29 · **Processo**: `.claude/skills/security/references/pre-deploy-gate.md`
- **Ferramentas**: revisão manual do código + testes adversariais e2e (89 testes) + Semgrep
  (`p/typescript`, `p/nodejsscan`, `p/secrets`, `--metrics=off`) + `npm audit --omit=dev`

## Escopo da alteração

- Feature: backend completo do MVP (feature única `001-backend-mvp`, US1–US8).
- Superfície: ~60 rotas REST em `/api` (públicas, cliente, dono, admin) + rotas do Better Auth em
  `/api/auth/*`; 20 tabelas; integrações Resend, Cloudinary e adaptador de WhatsApp; agendador interno.
- Blast radius: tudo é novo. Services compartilhados com mais de um consumidor foram revisados em
  todos os pontos de uso: `AvailabilityService` (listagem pública, listagem do dono, reserva, remarcação,
  destaques, busca), `AppointmentsService` (cliente, dono, balcão), `NotificationsService` (todos os
  eventos), `OwnerBusinessGuard` (todas as rotas `/owner/*`), `AuthGuard` (todas as rotas não públicas).

Fluxo verificado: `Cliente → Better Auth / AuthGuard → RolesGuard → OwnerBusinessGuard → ZodValidationPipe → Controller → Service → Prisma → PostgreSQL (constraints)`.

## Achados

```text
Vulnerabilidade: SR-1 Força bruta do código de acesso de 4 dígitos por WhatsApp
Severidade: HIGH (residual: MEDIUM, aceito)
Arquivo: src/auth/better-auth.ts
Linha: hook before de /phone-number/send-otp
Componente/Endpoint: POST /api/auth/phone-number/send-otp + /verify
Evidência: CONFIRMADO (cálculo sobre as regras configuradas)
Como pode ser explorada: 3 envios/10 min × 3 tentativas = ~1.300 palpites/dia contra o mesmo número
  (espaço de 10.000 códigos) → ~12% de chance por dia de entrar na conta de uma cliente específica.
Impacto: acesso à conta da cliente (nome, telefone, agendamentos), cancelamento de horários.
Correção aplicada: teto diário de 8 envios por telefone (OTP_DAILY_MAX) → máx. 24 palpites/dia (~0,24%/dia).
Como validar a correção: test/auth.e2e-spec.ts "teto diário de 8 envios por telefone" (429).
Risco residual: o tamanho do código (4 dígitos) é exigência do produto (docs/mvp-spec.md §3).
  Recomendação: passar para 6 dígitos (otpLength: 6) — decisão de produto pendente.
```

```text
Vulnerabilidade: SR-2 Sessão revogada continuava válida por até 60 s (cookie cache)
Severidade: HIGH
Arquivo: src/auth/better-auth.ts (session.cookieCache)
Componente/Endpoint: todas as rotas autenticadas
Evidência: CONFIRMADO (teste de reset de senha falhou durante a implementação)
Como pode ser explorada: sessão roubada continua utilizável por 60 s após reset de senha, bloqueio ou logout.
Impacto: janela de acesso após revogação.
Correção aplicada: cookieCache desligado; toda requisição valida a sessão no banco.
Como validar a correção: test/auth.e2e-spec.ts (reset revoga sessões) e test/admin-platform.e2e-spec.ts
  (bloqueio → 401 na requisição seguinte).
```

```text
Vulnerabilidade: SR-3 Dependências com advisories (better-auth 1.6.33, multer 2.4.0, js-yaml 5.4)
Severidade: CRITICAL/HIGH (advisories) — exposição real: LOW
Arquivo: package.json
Evidência: CONFIRMADO (npm audit). Os advisories críticos/altos do better-auth atingem plugins
  não usados (OAuth proxy, device authorization, OAuth state/magic link); multer: DoS com fileFilter
  assíncrono (não usamos fileFilter); js-yaml: só no Swagger, desligado em produção.
Correção aplicada: better-auth → 1.7.14; overrides multer ^2.5.0 e js-yaml ^5.5.0 (via @nestjs/swagger).
Como validar a correção: npm audit --omit=dev → restam 2 LOW (SR-7); suíte completa verde após upgrade.
```

```text
Vulnerabilidade: SR-4 Busca pública com custo ilimitado por requisição (API4)
Severidade: MEDIUM
Arquivo: src/marketplace/marketplace.service.ts, marketplace.schemas.ts, marketplace.controller.ts
Componente/Endpoint: GET /api/businesses (anônimo)
Evidência: PROVÁVEL (análise de código: availableToday/distância avaliavam até 500 candidatos com
  várias queries cada; cada card calcula próximos horários)
Correção aplicada: teto de 100 candidatos em memória, pageSize máx. 20 (padrão 12), throttle de 60/min por IP.
Como validar a correção: test/marketplace.e2e-spec.ts (busca e ordenação por distância continuam funcionando).
Recomendação futura: cache curto dos "próximos horários" por estabelecimento se a escala crescer.
```

```text
Vulnerabilidade: SR-5 Telefones guardados indefinidamente no log de envio de código
Severidade: LOW (LGPD — minimização)
Arquivo: src/notifications/notifications.scheduler.ts
Evidência: CONFIRMADO
Correção aplicada: limpeza de otp_send_logs com mais de 24 h a cada execução do agendador.
```

```text
Vulnerabilidade: SR-6 Bloqueio por conta pode ser usado para trancar um dono (DoS dirigido)
Severidade: LOW (aceito)
Arquivo: src/auth/better-auth.ts (hooks de /sign-in/email)
Evidência: POSSÍVEL
Como pode ser explorada: 5 senhas erradas para o e-mail de um dono trancam a conta por 15 min.
Mitigação existente: limite de 10 tentativas/15 min por IP no Better Auth; o bloqueio expira sozinho.
Por que aceito: proteção contra força bruta distribuída (auth-authz.md) tem prioridade; trava curta.
```

```text
Vulnerabilidade: SR-7 deepmerge (prototype poisoning) via nestjs-zod
Severidade: LOW (aceito)
Evidência: CONFIRMADO (npm audit). Usado apenas na geração do documento OpenAPI (Swagger desligado em
  produção); a "correção" do npm rebaixaria nestjs-zod para v4 (incompatível).
```

```text
Vulnerabilidade: SR-8 Foto de profissional aceita qualquer URL https
Severidade: INFORMATIONAL
Arquivo: src/professionals/professionals.module.ts (photoUrl)
Evidência: POSSÍVEL (pixel de rastreamento exibido a clientes). O servidor nunca busca a URL (sem SSRF).
Recomendação: quando houver upload de foto de profissional, usar o mesmo fluxo validado do Cloudinary.
```

```text
Vulnerabilidade: SR-9 Semgrep: helmet_header_x_powered_by e helmet_header_check_csp (src/main.ts)
Severidade: INFORMATIONAL
Evidência: FALSE POSITIVE — `app.disable('x-powered-by')` e CSP estão configurados exatamente nas
  linhas apontadas; a CSP agora só permite inline quando o Swagger está ativo (nunca em produção).
```

## Checklist por tópico

### Autenticação e Autorização (`references/auth-authz.md`)

- [x] Hash de senha pelo provedor (scrypt do Better Auth); nunca reimplementado — Resolvido
- [x] Rate limit em login, cadastro, reset, verificação de código e 2FA — Resolvido (regras por rota no Better Auth; throttler nas demais rotas)
- [x] Bloqueio por conta após 5 falhas (15 min) além do limite por IP — Resolvido (teste e2e)
- [x] Sessão expira (30 d; admin 8 h) e logout/reset/bloqueio revogam no servidor — Resolvido (SR-2)
- [x] Reset por link de uso único, 30 min, resposta idêntica para e-mail inexistente — Resolvido (teste e2e)
- [x] Cadastro não revela e-mail existente (usuário sintético do Better Auth) — Resolvido (verificado)
- [x] Papel nunca vem do cliente (`input: false` + hook no servidor) — Resolvido (teste e2e)
- [x] 2FA obrigatório para SUPER_ADMIN; admin criado só por seed — Resolvido (teste e2e)
- [x] Autorização no servidor em toda rota; papel e bloqueio relidos do banco a cada requisição — Resolvido
- [x] IDOR: `businessId` sempre da sessão; IDs alheios → 404 em todas as rotas `/owner` e `/me` — Resolvido (SC-002, test/tenant-isolation.e2e-spec.ts)
- [x] JWT — Não aplicável (sessões opacas no banco)

### Injection (`references/injection.md`)

- [x] SQL: Prisma API + 3 usos de `$queryRaw` com template tag parametrizado (`FOR UPDATE`); nenhum `$queryRawUnsafe` — Resolvido
- [x] XSS em e-mail: conteúdo de usuário passa por `escapeHtml` — Resolvido
- [x] CSRF: cookies `SameSite=Lax` + `HttpOnly` + `Secure` em produção; checagem de origem do Better Auth; CORS por allowlist — Resolvido
- [x] SSRF — Não aplicável (o servidor não busca URLs de usuário)
- [x] Path traversal — Não aplicável (nome no storage = id do estabelecimento + slot fixo)
- [x] Command injection — Não aplicável

### API (`references/api-security.md`)

- [x] Rate limiting com resposta 429 genérica — Resolvido (não validável por teste automatizado: em `NODE_ENV=test` os limites por IP ficam altos porque todos os testes saem do mesmo IP; limites por telefone/conta são testados)
- [x] CORS: allowlist explícita, credenciais, métodos e headers restritos — Resolvido
- [x] Headers: helmet (CSP estrita fora do Swagger, HSTS, nosniff, referrer-policy), `x-powered-by` removido — Resolvido
- [x] Mass assignment: todos os schemas Zod `.strict()`; campos administrativos só por rotas de admin — Resolvido (teste: `status` no PATCH → 400)
- [x] HTTP parameter pollution: parâmetro duplicado vira array e é recusado pelo Zod — Resolvido
- [x] Paginação obrigatória (máx. 50; busca pública máx. 20) — Resolvido
- [x] Erros sem stack/SQL/Prisma; 500 genérico — Resolvido
- [x] Webhooks recebidos — Não aplicável (sem gateway de pagamento no MVP)

### Secrets, Exposição de Dados, Logs, Dependências, Config de Produção (`references/data-secrets-logging.md`)

- [x] Secrets só em env; `.env*` ignorado pelo git (verificado com `git check-ignore`); `.env.example` só com placeholders — Resolvido
- [x] Env validado com Zod no boot; produção exige Resend e Cloudinary e recusa Swagger ligado — Resolvido
- [x] Respostas com `select` explícito; nenhum hash/token/segredo exposto; e-mail técnico de telefone oculto — Resolvido (teste de exportação LGPD)
- [x] Logs mascaram telefone/e-mail; nunca logam corpo, cookies ou códigos (exceto log de debug do código **somente em `development`**, para login sem provedor de WhatsApp) — Resolvido
- [x] Health check só retorna status — Resolvido
- [x] `npm audit` — Resolvido (SR-3), restam 2 LOW aceitos (SR-7)
- [x] Banco: usuário da aplicação não é superusuário; porta do Postgres só em 127.0.0.1 no compose — Resolvido (dev). `CREATEDB` só no papel de desenvolvimento para o banco sombra do Prisma
- [ ] Dependabot/Renovate e `npm audit` no CI — Pendente (não há CI configurado ainda) → registrado em riscos aceitos

### Upload de Arquivos (`references/file-uploads.md`)

- [x] Tipo validado por magic bytes (JPEG/PNG/WebP); SVG e extensão falsa recusados — Resolvido (teste e2e)
- [x] Limite de 5 MB no servidor (multer) — Resolvido
- [x] Nome no storage gerado pelo servidor, determinístico por estabelecimento — Resolvido
- [x] Armazenamento fora do servidor (Cloudinary), `allowed_formats` e reprocessamento na entrada — Resolvido

### RLS no Supabase (`references/supabase-rls.md`)

Não aplicável (preset `prisma-postgres`).

## Riscos aceitos explicitamente

Aceitos pelo agente sob delegação de decisões do usuário (ausente durante a execução); **devem ser
revisados pelo usuário**:

1. **SR-1 residual** — código de 4 dígitos (exigência do produto). Recomendado migrar para 6 dígitos.
2. **SR-6** — bloqueio temporário de conta de dono por terceiros (15 min).
3. **SR-7** — deepmerge LOW via nestjs-zod (Swagger, fora de produção).
4. **CI ausente** — sem pipeline com `npm audit`/Dependabot ainda.
5. **Rate limiter em memória** — válido para instância única (Princípio XII); com múltiplas instâncias
   será preciso armazenamento compartilhado.
6. **Credenciais de teste fixas** em `test/test-env.ts` e `docker-compose.yml` — só para banco local
   (`127.0.0.1`), nunca usadas em outro ambiente.

## Security Gate

```text
Status: PASS WITH WARNINGS

CRITICAL: 0
HIGH: 0   (2 encontrados e corrigidos: SR-1, SR-2; advisories de SR-3 corrigidos)
MEDIUM: 0 abertos (SR-4 corrigido; SR-1 residual aceito)
LOW: 2 abertos e aceitos (SR-6, SR-7)
INFORMATIONAL: 2 (SR-8, SR-9 falso positivo)
```

Não foram identificadas vulnerabilidades CRITICAL/HIGH abertas dentro do escopo e dos testes
realizados. Antes do lançamento público, rodar `/security-audit` (auditoria completa) e o
`saas-hardening-checklist.md` (backups, resposta a incidente, política de privacidade).
