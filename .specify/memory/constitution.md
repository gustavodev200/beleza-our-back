<!--
Sync Impact Report
- Version change: 1.0.0 → 1.1.0 (MINOR: novos princípios anexados)
- Modified principles: nenhum (I–VII preservados sem alteração)
- Added sections: "Princípios do Produto — belezaOur Backend"
  (VIII Isolamento por Estabelecimento, IX Agenda Consistente Garantida no
  Banco, X Tempo e Dinheiro sem Ambiguidade, XI Efeitos Externos Após o
  Commit, XII Escopo MVP Enxuto)
- Removed sections: nenhuma
- Templates: nenhum alterado (lêem a constituição em runtime)
- Deferred TODOs: nenhum
-->
# Workspace Agents — Base Constitution

Princípios fixos herdados por todo projeto criado a partir deste workspace.
Lida como gate pelo `/speckit-plan` oficial (seção "Constitution Check") —
uma feature cujo plano viole um destes princípios deve justificar a exceção
em "Complexity Tracking" do `plan.md`, não ignorar silenciosamente.

Um projeto concreto pode **adicionar** princípios próprios rodando
`/speckit-constitution` (preserva o conteúdo abaixo e anexa o que for
específico do produto), mas não deve contradizer os princípios herdados
sem registrar explicitamente a exceção e o motivo.

## Core Principles

### I. Stack Declarada, Não Assumida

O preset ativo vem sempre de `project.config.json` (`prisma-postgres` ou
`supabase`), nunca de suposição. Nenhuma feature assume Prisma num projeto
Supabase ou vice-versa. Antes de `/speckit-plan` preencher "Technical
Context", leia `project.config.json` e a skill `core/stack-detection` para
saber quais skills de stack são elegíveis.

### II. Zod na Borda, Sempre

Toda entrada externa (form, API, webhook, query param) é validada com Zod
antes de tocar lógica de negócio, nos dois presets. Não-negociável: não
existe caminho de dado externo que pule essa validação por conveniência.

### III. Autorização Explícita no Servidor

Sessão válida não é autorização. Toda ação sensível verifica, no servidor,
se o usuário pode especificamente fazer aquilo (ownership/RBAC). No preset
Supabase isso é reforçado por RLS (Princípio IV); no preset Prisma é código
explícito no service. Esconder algo no frontend nunca conta como proteção.

### IV. RLS Obrigatória em Tabelas Supabase

Toda tabela exposta via `supabase-js`/PostgREST tem Row Level Security
habilitada com policy explícita, criada na mesma migration que cria a
tabela. Uma tabela sem policy fica bloqueada por padrão — isso é o estado
correto, não um bug a "destravar" com `USING (true)` por conveniência.

### V. Segurança Antes do Code Review

O comando `/security` (Security Gate — ver
`.claude/skills/security/references/pre-deploy-gate.md`) roda antes do
`/review` sempre que a feature tocar autenticação, dado de usuário, upload
ou integração externa. Achados CRITICAL ou HIGH pendentes bloqueiam a
aprovação final (`/review` não pode declarar Aprovado com Gate em FAIL).

### VI. YAGNI

Nenhuma abstração, flag, camada ou dependência é adicionada para caso
hipotético — nem em código de projeto, nem em mudanças neste próprio
workspace-template. Complexidade nova precisa de justificativa real,
registrada em "Complexity Tracking" do `plan.md` quando aplicável.

### VII. Rastreabilidade Spec → Review

Toda feature de porte médio+ produz, em `specs/<NNN>-<slug>/`: `spec.md`
(`/speckit-specify`, com clarificações incorporadas na própria seção
`## Clarifications` via `/speckit-clarify` — não um arquivo separado),
`plan.md` (`/speckit-plan`), `tasks.md` (`/speckit-tasks`), e, quando
aplicável, `security-review.md` (`/security`) e `code-review.md`
(`/review`).

## Princípios do Produto — belezaOur Backend

Anexados por `/speckit-constitution` em 2026-10-29. Complementam (não
substituem) os princípios I–VII. Fonte do produto: `docs/mvp-spec.md`.

### VIII. Isolamento por Estabelecimento

Toda rota do painel do dono resolve o `businessId` **a partir da sessão**
(o estabelecimento do usuário autenticado), nunca de body, query ou path
enviado pelo cliente. Todo acesso a recurso com ID (serviço, profissional,
agendamento, bloqueio) filtra por esse `businessId` no `WHERE` da query.
Recurso de outro estabelecimento responde `404` (não `403`), para não
revelar existência. `role` e status do usuário vêm sempre do banco/sessão.
Cada rota do painel tem teste negativo de acesso cruzado.

### IX. Agenda Consistente Garantida no Banco

"Horário mostrado = horário realmente livre." A regra de disponibilidade
(expediente, almoço, bloqueios, agendamentos ativos, duração, passado) vive
num único service usado tanto pela listagem de horários quanto pela
gravação. Conflito entre agendamentos ativos da mesma profissional é
impedido por **exclusion constraint** no PostgreSQL (`btree_gist` +
`tstzrange`), e a criação/remarcação roda em transação que trava a linha da
profissional. Validação prévia sozinha nunca conta como garantia.

### X. Tempo e Dinheiro sem Ambiguidade

Instantes são gravados como `timestamptz` em UTC; regras de calendário
(dia, expediente, "hoje", prazos) são calculadas em `America/Sao_Paulo`.
Valores monetários são inteiros em centavos. Preço e duração do serviço são
copiados para o agendamento no momento da reserva e nunca recalculados.

### XI. Efeitos Externos Após o Commit

Envio de WhatsApp, e-mail (Resend) e chamadas de notificação acontecem
**depois** do commit da operação de negócio. Falha de provedor externo é
registrada em log (sem dado sensível) e nunca desfaz, bloqueia ou duplica a
operação já gravada. Exceção explícita: verificação de e-mail e recuperação
de senha, em que o e-mail é parte do próprio fluxo. Upload para Cloudinary
acontece antes de gravar a referência, com nome determinístico por recurso
(sobrescrever, não acumular).

### XII. Escopo MVP Enxuto

O MVP opera **somente com o plano Free**: não há gateway de pagamento,
assinatura, fatura ou reembolso. Não entram Redis, filas, microsserviços,
WebSocket, PostGIS ou RBAC genérico — três roles fixos (`CLIENT`,
`BUSINESS_OWNER`, `SUPER_ADMIN`) com regras explícitas no service. Qualquer
item da seção "Fora do MVP" de `docs/mvp-spec.md` exige emenda desta
constituição antes de ser planejado.

## Integração com o Spec-Kit Oficial

Este workspace usa o [spec-kit](https://github.com/github/spec-kit) oficial
como motor do fluxo Specification → Clarification → Plan → Tasks →
Implementation (`/speckit-specify`, `/speckit-clarify`, `/speckit-plan`,
`/speckit-tasks`, `/speckit-implement`, mais os opcionais
`/speckit-analyze`, `/speckit-checklist`, `/speckit-converge`). Os comandos
`/test`, `/security`, `/security-audit`, `/review` e `/seo` são específicos
deste workspace e rodam **depois** de `/speckit-implement` — não têm
equivalente oficial. Nunca edite os templates em `.specify/templates/`
esperando que sobrevivam a um `specify self upgrade`; customizações de
fluxo pertencem a este arquivo (lido como contexto por todos os comandos
oficiais) ou aos comandos/skills próprios deste workspace.

## Como um Projeto Estende Isto

Rode `/speckit-constitution` no projeto novo para anexar princípios
específicos do produto (ex.: "toda feature de billing passa por revisão do
responsável financeiro") — o comando preserva os princípios herdados acima
e adiciona os novos. Não remova um princípio herdado; se ele não se aplica,
registre a exceção explicitamente com o motivo em vez de apagá-lo.

## Governance

Este documento tem precedência sobre convenção de código ou preferência
individual dentro do escopo de um projeto gerado a partir deste workspace.
Emenda requer: descrição da mudança, incremento de versão semântica
(MAJOR = remoção/redefinição incompatível de princípio; MINOR = princípio
novo ou seção expandida; PATCH = redação/clarificação) e atualização da
data de "Last Amended" abaixo. `/speckit-plan` deve recusar avançar se o
"Constitution Check" apontar violação não justificada.

**Version**: 1.1.0 | **Ratified**: 2026-09-08 | **Last Amended**: 2026-10-29
