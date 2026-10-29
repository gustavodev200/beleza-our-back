# belezaOur — Especificação do MVP

**Referência visual e de fluxo:** `belezaOur.dc.html` (Cliente Web · Cliente PWA · Dono do estabelecimento · Super Admin)
**Cidade de lançamento:** Goiânia-GO (arquitetura já multi-cidade)
**Plataformas:** web responsiva + PWA instalável (um único app)

---

## 1. Visão do produto

Marketplace local para **descobrir, comparar e agendar** serviços de beleza e bem-estar — salões femininos, barbearias, estúdios de sobrancelha/cílios, clínicas de estética e profissionais autônomas — com um **painel de gestão** para o estabelecimento e um **dashboard de administração** para a plataforma.

**Problemas que o MVP resolve**
- Cliente: não precisa trocar mensagens com vários profissionais para achar horário; vê preço, avaliação e horários reais.
- Estabelecimento: agenda organizada por profissional, sem conflito de horário, e um link próprio para divulgar no Instagram e WhatsApp.
- Plataforma: controle de qualidade — **nenhum estabelecimento vai ao ar sem aprovação**.

**Princípios**
- Agendar em poucos toques, sem cadastro obrigatório.
- Horário mostrado = horário realmente livre.
- Mobile-first; WhatsApp como canal principal de comunicação.

---

## 2. Roles e permissões

| Role | Quem é | Acesso |
|---|---|---|
| `CLIENT` | Cliente final | App do cliente (web/PWA) |
| `BUSINESS_OWNER` | Dono do estabelecimento | Painel do estabelecimento |
| `SUPER_ADMIN` | Administrador da plataforma | Dashboard administrativo |

### Matriz de permissões

| Ação | CLIENT | BUSINESS_OWNER | SUPER_ADMIN |
|---|:-:|:-:|:-:|
| Buscar e ver estabelecimentos ativos | ✔ | ✔ | ✔ |
| Agendar, remarcar e cancelar o próprio agendamento | ✔ | — | — |
| Avaliar atendimento concluído | ✔ | — | — |
| Favoritar estabelecimentos | ✔ | — | — |
| Cadastrar estabelecimento (vai para aprovação) | — | ✔ | — |
| Gerenciar perfil, capa e logo do próprio negócio | — | ✔ | ✔ (moderação) |
| Gerenciar serviços, profissionais e horários | — | ✔ (só o seu) | — |
| Ver e gerenciar agenda e agendamentos | — | ✔ (só o seu) | ✔ (leitura) |
| Criar agendamento de balcão e bloquear horários | — | ✔ | — |
| Ver clientes que agendaram no negócio | — | ✔ | ✔ |
| Aprovar, recusar, suspender e reativar estabelecimentos | — | — | ✔ |
| Destacar estabelecimentos na página inicial | — | — | ✔ |
| Gerenciar usuários (bloquear e desbloquear) | — | — | ✔ |
| Gerenciar categorias, planos e configurações globais | — | — | ✔ |

**Regras de acesso**
- Toda rota do painel valida que o `BUSINESS_OWNER` é dono do `business_id` acessado.
- Um estabelecimento com status `pendente`, `recusado` ou `suspenso` **não aparece** no marketplace e seu link público retorna "indisponível".
- Usuário bloqueado não consegue entrar nem agendar.
- Ações do `SUPER_ADMIN` ficam registradas em auditoria.

---

## 3. Autenticação

| | CLIENT | BUSINESS_OWNER | SUPER_ADMIN |
|---|---|---|---|
| Método | Telefone + código de 4 dígitos no WhatsApp (sem senha) | E-mail + senha | E-mail + senha + código de 6 dígitos (2FA) |
| Cadastro | Abas "Entrar" / "Criar conta" (nome + WhatsApp) **ou** automático no primeiro agendamento | Cadastro de conta do dono como passo 1 do onboarding | Criado internamente (sem cadastro público) |
| Recuperação | Novo código | "Esqueci minha senha" → link por e-mail | Suporte interno |
| Sessão | Access token 15 min + refresh 30 dias | Idem | Access token 15 min + refresh 8h |

**Regras**
- Código expira em 5 min; máximo de 3 envios a cada 10 min por telefone/IP; reenviar liberado após 30s.
- Rotas protegidas do cliente (Agendamentos, Favoritos, Perfil, Notificações) redirecionam para o login e voltam à tela de origem.
- Senha do dono: no mínimo 6 caracteres no MVP (recomendado 8 em produção).

---

## 4. CLIENT — features

### 4.1 Início
- Busca "Qual serviço você procura?" + cidade (Goiânia - GO).
- Buscas populares (Manicure, Corte masculino, Design de sobrancelhas, Escova).
- Grade de categorias: Unhas, Sobrancelhas, Cabelo, Barbearia, Estética, Maquiagem, Depilação (somente as ativas no Admin).
- **Em destaque**: cards controlados pelo Admin, com foto, nota, nº de avaliações, distância e **chips dos próximos 3 horários livres** — tocar num chip abre o agendamento com aquele horário já selecionado.
- Faixa "Para profissionais" → cadastro do estabelecimento.
- PWA: banner "Instale o belezaOur" (dispensável).

### 4.2 Explorar
- Busca por nome, serviço ou bairro.
- Filtros: categoria, bairro, ordenar (relevância, mais perto, melhor avaliados, menor preço), "com horário hoje".
- Resultado: foto, nome, tipo, selo "Autônoma"/"Novo", nota, distância, bairro, "a partir de R$", próximos horários, favoritar, "Ver horários".
- Estado vazio com "Limpar filtros". Filtros refletidos na URL.

### 4.3 Perfil do estabelecimento (`belezaour.app/{slug}`)
- **Capa e logo** enviadas pelo dono; selo de verificado; nota e avaliações; distância; "Aberto agora / Fechado hoje".
- Ações: Favoritar, Compartilhar (link), Mapa / Como chegar, WhatsApp.
- Abas: **Serviços** (nome, duração, preço, "Agendar"), **Profissionais** (foto, função, nota, "Agendar com…"), **Avaliações**, **Sobre** (descrição, tipo, horário de funcionamento, endereço, telefone).
- Card fixo "Agendar agora" com o próximo horário livre e o preço inicial.
- Página com SEO e prévia para compartilhar no Instagram e WhatsApp.

### 4.4 Agendamento (tela única em passos)
1. Serviço
2. Profissional (inclui "Sem preferência")
3. Data (próximos 7 dias; dias fechados desabilitados)
4. Horário (ocupados aparecem riscados e não são clicáveis)
5. Nome + WhatsApp (sem cadastro)
- Resumo fixo: serviço, profissional, data, horário, duração, total, "Pagamento no local".
- Botão desabilitado até tudo ser válido, com dica do que falta.
- Se o horário for reservado por outra pessoa no meio do processo → aviso e lista de horários atualizada.
- O mesmo fluxo serve para **Remarcar** (título "Remarcar horário").

### 4.5 Confirmação
- "Horário confirmado!", resumo, "Adicionar ao calendário", "Abrir no mapa", "Ver meus agendamentos".
- Confirmação enviada no WhatsApp + notificação no app.

### 4.6 Meus agendamentos
- Abas **Próximos** e **Histórico**.
- Próximos: ver estabelecimento, como chegar, **remarcar**, **cancelar** (com confirmação inline; respeita o prazo definido pelo Admin).
- Histórico: status (Concluído, Cancelado, Não compareceu), **Avaliar atendimento**, "Agendar novamente".

### 4.7 Avaliação
- Modal: 1–5 estrelas, tags (Pontual, Atenciosa, Ambiente limpo, Ótimo resultado, Preço justo) e texto opcional.
- Só para agendamento `concluido` e uma vez por agendamento; aparece no perfil e atualiza a nota média.

### 4.8 Favoritos, Notificações e Perfil
- Favoritos: lista com atalho para agendar; estado vazio com "Explorar".
- Notificações: confirmações, alterações feitas pelo estabelecimento, lembretes; badge no sino; marcadas como lidas ao abrir.
- Perfil (PWA): dados, favoritos, notificações, ajuda, sair, atalho "Área do profissional".

---

## 5. BUSINESS_OWNER — features

### 5.1 Entrada
- Tela dividida: proposta de valor + formulário "Entrar no painel" (e-mail e senha), "Esqueci minha senha" e "Cadastrar meu estabelecimento".

### 5.2 Onboarding (6 passos, com barra de progresso)
1. **Conta** — nome, e-mail, senha
2. **Tipo** — Salão · Barbearia · Estúdio · Profissional autônoma · Estética
3. **Dados** — nome público, WhatsApp, bairro (gera o slug `belezaour.app/nome-do-negocio`)
4. **Serviços** — sugestões por tipo (nome, duração, preço), editáveis depois
5. **Horários** — dias de atendimento, abertura e fechamento
6. **Capa e logo** — upload com pré-visualização do perfil
- Validação por passo (campos inválidos destacados).
- "Enviar para aprovação" → status `pendente`.

### 5.3 Status do cadastro
- **Em análise**: linha do tempo (Enviado → Revisão → No ar), prazo de até 24h úteis, edição de capa e logo liberada.
- **Aprovado**: "Seu perfil está no marketplace!" + "Ver meu perfil público".
- **Ajustes necessários** (recusado): motivo + "Revisar e reenviar" (volta para `pendente`).
- O painel operacional só é liberado após a aprovação.

### 5.4 Visão geral
- Saudação, data, atalhos **Novo agendamento** e **Bloquear horário**.
- Cards: agendamentos hoje, receita prevista hoje, aguardando ação.
- Agenda de hoje (clicável) e lista **Novos e pendentes** (selo NOVO para os que vieram pelo app; botão Confirmar).

### 5.5 Agenda
- Visões **Semana** e **Dia**; navegação ←, →, Hoje.
- Filtro por profissional (toggles), cada uma com uma cor.
- Blocos posicionados por horário e duração:
  - confirmado: preenchido;
  - pendente: borda tracejada;
  - não compareceu: esmaecido;
  - pausa de almoço e dia fechado: hachurados;
  - bloqueio: hachurado, clicar remove.
- Sobreposição de horários é exibida lado a lado.
- **Gaveta de detalhes** ao clicar: cliente, telefone, WhatsApp, serviço, horário, duração, profissional, valor, origem (App/Balcão), observações.
  - Ações: Confirmar · Marcar como concluído · Cancelar · Não compareceu · Reabrir.
  - Toda mudança notifica a cliente.

### 5.6 Novo agendamento (balcão)
- Cliente + WhatsApp, serviço, profissional, data e **somente horários livres**. Origem = `balcao`.

### 5.7 Bloquear horário
- Profissional, dia, início, duração (1h, 2h, 4h, dia inteiro), motivo (compromisso, folga, almoço estendido, curso).
- Aviso se houver agendamentos no período.
- O horário bloqueado some imediatamente da agenda online das clientes.

### 5.8 Serviços
- Tabela: nome, categoria, duração, preço, toggle **Visível no app** (oculto some do marketplace na hora).
- Criar, editar e excluir.

### 5.9 Profissionais
- Cards com foto, função, atendimentos da semana e "Ver agenda" (abre a agenda filtrada).
- Criar, editar e desativar; vincular aos serviços que atende.

### 5.10 Perfil público
- Editar **capa e logo**, descrição, endereço, horário de funcionamento e categorias.
- Link `belezaour.app/{slug}`: Copiar, Enviar no WhatsApp, Bio do Instagram, **Ver como cliente**.

### 5.11 Minha agenda (PWA)
- Faixa de dias + lista do dia (horário, cliente, serviço, profissional, status, "Confirmar"), com atalho para o painel completo.

---

## 6. SUPER_ADMIN — features (dashboard)

### 6.1 Entrada
- E-mail corporativo + senha → código 2FA de 6 dígitos. Aviso de auditoria.

### 6.2 Dashboard
- KPIs:
  - estabelecimentos ativos;
  - aguardando aprovação (clicável);
  - agendamentos na semana;
  - volume agendado (R$);
  - clientes;
  - taxa de ausência.
- Gráfico de agendamentos por dia (hoje destacado).
- Barras de agendamentos por categoria.
- Fila de aprovação (atalho Aprovar) e ranking dos mais agendados na semana.
- Filtro de cidade e período.

### 6.3 Aprovações
- Card por cadastro: capa, logo, nome, tipo, bairro, data de envio, responsável (nome, e-mail, WhatsApp), horários, serviços.
- **Aprovar e publicar** → status `ativo`, aparece em Explorar, dono notificado.
- **Recusar** (com motivo) → status `recusado`, dono notificado e pode reenviar.

### 6.4 Estabelecimentos
- Tabela: nome, dono, tipo, bairro, nota, plano, status, destaque.
- Ações: Ver perfil, **Suspender/Reativar**, toggle **Destaque** (controla "Em destaque" na home), trocar plano.

### 6.5 Usuários
- Filtros: Todos, Clientes, Donos, Admins (com contagem).
- Tabela: nome, contato, role, estabelecimento vinculado, status. Ação **Bloquear/Desbloquear** (não se aplica a admins).

### 6.6 Categorias
- Cards com ícone, nº de estabelecimentos, agendamentos na semana e toggle **Visível no app**.
- Criar, editar e reordenar.

### 6.7 Planos
- **Grátis** (R$ 0): vitrine, agenda online, link próprio, até 2 profissionais, notificações in-app.
- **Pro** (R$ 49/mês): tudo do Grátis, profissionais ilimitados, lembretes no WhatsApp, prioridade nos destaques locais, relatórios do mês.
- Contagem por plano; edição de plano. Cobrança **manual** no MVP.

### 6.8 Configurações globais
- Aprovação obrigatória de estabelecimentos (sempre ativa, não editável).
- Prazo de cancelamento gratuito pela cliente (1h, 2h, 6h ou 24h) — refletido no agendamento.
- Lembretes automáticos no WhatsApp (24h e 2h antes).
- Pedir avaliação após o atendimento.
- Cidades atendidas (ativar e desativar; Goiânia é a de lançamento).

---

## 7. Regras de negócio

### 7.1 Disponibilidade
Um horário só fica livre se **todas** as condições abaixo forem verdadeiras:
- dentro do horário de funcionamento;
- fora da pausa de almoço;
- sem bloqueio da profissional;
- sem agendamento `confirmado` ou `pendente` sobreposto;
- termina antes do fechamento (conta a duração do serviço);
- não está no passado.

Com **"Sem preferência"**, basta uma profissional apta estar livre; ela é atribuída na confirmação.

### 7.2 Concorrência
Duas reservas simultâneas para o mesmo horário e a mesma profissional → uma é criada e a outra recebe "horário acabou de ser reservado" (garantido no banco de dados).

### 7.3 Status do agendamento

| Status | Origem da mudança |
|---|---|
| `confirmado` | Padrão do app; ou confirmado pelo dono a partir de `pendente` |
| `pendente` | Aguardando confirmação do estabelecimento |
| `concluido` | Dono marca após o atendimento → libera avaliação |
| `cancelado` | Cliente (dentro do prazo) ou dono |
| `nao_compareceu` | Dono |
| Reabrir | Dono volta um agendamento encerrado para `confirmado` |

### 7.4 Status do estabelecimento
`pendente` → `ativo` | `recusado` → (reenviar) `pendente`; `ativo` ↔ `suspenso`.

### 7.5 Avaliações
Uma por agendamento concluído. Recalcula a nota média e o nº de avaliações.

### 7.6 Preço
O valor do agendamento é registrado no momento da reserva; mudanças futuras de preço não alteram agendamentos já feitos.

### 7.7 Fuso
`America/Sao_Paulo`.

---

## 8. Notificações

| Evento | Cliente | Dono | Canal |
|---|:-:|:-:|---|
| Código de acesso | ✔ | — | WhatsApp |
| Novo agendamento | ✔ (confirmação) | ✔ (selo NOVO + sino) | WhatsApp + in-app |
| Confirmado / concluído / cancelado / não compareceu pelo dono | ✔ | — | WhatsApp + in-app |
| Cancelamento ou remarcação pela cliente | — | ✔ | in-app |
| Lembrete 24h e 2h antes | ✔ | — | WhatsApp (se ativo) |
| Convite para avaliar (2h após concluir) | ✔ | — | WhatsApp + in-app (se ativo) |
| Cadastro aprovado ou recusado | — | ✔ | WhatsApp + e-mail |

---

## 9. Mapa de telas

**Cliente (web + PWA):**
1. Início
2. Explorar
3. Perfil do estabelecimento
4. Agendamento / Remarcar
5. Confirmação
6. Meus agendamentos
7. Avaliar (modal)
8. Favoritos
9. Notificações
10. Entrar / Criar conta
11. Perfil (PWA)
12. Minha agenda do profissional (PWA)

**Dono:**
1. Entrar
2. Onboarding (6 passos)
3. Status do cadastro
4. Visão geral
5. Agenda (Semana/Dia + gaveta)
6. Novo agendamento (modal)
7. Bloquear horário (modal)
8. Serviços
9. Profissionais
10. Perfil público

**Super Admin:**
1. Entrar + 2FA
2. Dashboard
3. Aprovações
4. Estabelecimentos
5. Usuários
6. Categorias
7. Planos
8. Configurações

---

## 10. Identidade visual

- **Fonte:** Noto Sans (400–800), única no projeto. **Ícones:** Material Symbols Outlined.
- **Paleta:**
  - Tinta: `#14242b`
  - Fundo: `#f7f7f5`
  - Superfície: `#ffffff`
  - Texto secundário: `#66737a`
  - Linhas: `#e6e9ea`
  - Primária petróleo: `oklch(0.5 0.09 210)`
  - Acento rosé: `oklch(0.6 0.13 12)` — conversa com o público feminino e o masculino
- **Status:**
  - confirmado: `#e6f5ec` / `#1d7a44`
  - pendente: `#fdf1d8` / `#8a5208`
  - cancelado/ausente: `#fdeceb` / `#b42318`
  - concluído: `#eef0f4` / `#4b5563`
- Raios de 10–24px, sombras suaves, alvos de toque com no mínimo 44px, contraste AA.

---

## 11. Requisitos não funcionais

- PWA: manifest, ícones, service worker, tela offline, cache de listas e perfil.
- Performance: LCP < 2,5s em 4G; páginas públicas pré-renderizadas para SEO.
- Acessibilidade: navegação por teclado, foco visível, Esc fecha modais, estados de seleção anunciados.
- Estados de carregamento, vazio e erro em todas as listas; toast de retorno em toda ação.
- Segurança: limite de tentativas no login, 2FA no admin, isolamento por estabelecimento, auditoria.
- LGPD: consentimento para WhatsApp, exclusão de conta, exportação de dados.
- Imagens: capa até 1600×600 e logo quadrada até 512×512, compressão automática.

---

## 12. Fora do MVP

Pagamento online e split, cobrança automática de planos, comissões, estoque, programa de fidelidade/cashback, chat interno, app nativo, múltiplas unidades por dono, relatórios financeiros avançados, IA de recomendação.

---

## 13. Métricas de sucesso (primeiros 90 dias em Goiânia)

- Estabelecimentos aprovados e ativos.
- Agendamentos por semana e % vindos do link próprio vs. marketplace.
- Conversão perfil → agendamento.
- Taxa de cancelamento e de não comparecimento.
- Nota média e % de agendamentos avaliados.
- Tempo médio de aprovação de cadastro (meta < 24h).
