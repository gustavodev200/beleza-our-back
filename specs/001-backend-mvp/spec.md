# Feature Specification: Backend MVP do belezaOur

**Feature Branch**: `001-backend-mvp`

**Created**: 2026-10-29

**Status**: Draft

**Input**: User description: "Backend MVP completo do belezaOur — API para marketplace de agendamento de beleza em Goiânia, conforme `docs/mvp-spec.md`, apenas backend. Somente plano Free; login/cadastro/recuperação/verificação de e-mail do dono; cliente entra por código no WhatsApp; admin com segundo fator; imagens de capa e logo; disponibilidade e concorrência garantidas; notificações; administração e LGPD."

Fonte do produto: [`docs/mvp-spec.md`](../../docs/mvp-spec.md). Esta especificação cobre **somente o
backend** (regras de negócio, dados, segurança e contratos consumidos pelo app web/PWA). Telas,
identidade visual e comportamento de interface são responsabilidade do frontend.

## Clarifications

### Session 2026-10-29 (decisões delegadas pelo usuário)

- Q: Haverá cobrança/planos pagos no MVP? → A: Não. Somente plano Free; sem gateway (Asaas descartado no MVP).
- Q: O cliente precisa verificar o telefone para reservar ("sem cadastro")? → A: Sim, por código de 4 dígitos; a conta é criada automaticamente, sem senha nem formulário.
- Q: Qual o status padrão de reservas do app? → A: `confirmado`; `pendente` só quando o estabelecimento ativa "exigir confirmação".
- Q: Como fica o limite de 2 profissionais do plano Free? → A: Configuração global editável pelo admin, padrão 2.
- Q: Segundo fator do admin? → A: App autenticador (código de 6 dígitos baseado em tempo).
- Q: Granularidade dos horários? → A: 15 minutos; duração de serviço em múltiplos de 5 minutos.
- Q: Remarcar cria novo agendamento? → A: Não; o mesmo agendamento muda de horário, mantendo o preço registrado.
- Q: Excluir serviço com agendamentos? → A: Não permitido; ocultar.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Cliente agenda um horário realmente livre (Priority: P1)

A cliente escolhe um estabelecimento ativo, um serviço, uma profissional (ou "sem preferência"),
uma data nos próximos 7 dias e um horário livre. Informa nome e WhatsApp, confirma o telefone com
um código de 4 dígitos e recebe o agendamento confirmado (ou pendente, se o estabelecimento exige
confirmação). Pagamento é sempre no local.

**Why this priority**: É o motivo de existir do produto — sem reserva confiável não há marketplace.

**Independent Test**: Com um estabelecimento ativo semeado (serviço, profissional, horários), uma
cliente consegue listar horários livres, verificar o telefone e criar um agendamento; duas
tentativas simultâneas para o mesmo horário resultam em exatamente uma reserva.

**Acceptance Scenarios**:

1. **Given** um horário livre, **When** a cliente com telefone verificado confirma a reserva, **Then** o agendamento é criado com o preço e a duração vigentes naquele momento e status `confirmado` (ou `pendente` se o estabelecimento exige confirmação).
2. **Given** duas clientes reservando o mesmo horário com a mesma profissional ao mesmo tempo, **When** ambas confirmam, **Then** exatamente uma reserva é criada e a outra recebe "horário acabou de ser reservado" com a lista de horários atualizada.
3. **Given** um horário no passado, fora do expediente, na pausa de almoço, bloqueado, ocupado ou que terminaria após o fechamento, **When** a cliente consulta ou tenta reservar, **Then** o horário não aparece como livre e a reserva é recusada.
4. **Given** "sem preferência", **When** existe ao menos uma profissional apta e livre, **Then** o horário aparece livre e uma profissional é atribuída na confirmação.
5. **Given** um telefone ainda não verificado, **When** a cliente tenta reservar, **Then** a reserva é recusada até a verificação por código.

---

### User Story 2 - Dono cadastra o estabelecimento e envia para aprovação (Priority: P1)

O dono cria a conta com e-mail e senha, confirma o e-mail pelo link recebido, informa tipo, nome
público, WhatsApp, cidade, bairro, serviços, profissionais, horários de funcionamento, capa e logo,
e envia o cadastro para aprovação.

**Why this priority**: Sem oferta aprovada não há o que agendar.

**Independent Test**: Um dono novo consegue completar o cadastro e enviá-lo; o estabelecimento fica
`pendente` e invisível no marketplace.

**Acceptance Scenarios**:

1. **Given** um dono com e-mail não verificado, **When** tenta entrar, **Then** o acesso é negado e um novo link de verificação pode ser enviado.
2. **Given** um cadastro sem ao menos um serviço visível, uma profissional ativa vinculada a ele e horário de funcionamento, **When** o dono envia para aprovação, **Then** o envio é recusado com a indicação do que falta.
3. **Given** um cadastro completo, **When** enviado, **Then** o status vira `pendente`, o estabelecimento não aparece em buscas e seu link público responde "indisponível".
4. **Given** o nome público "Studio Bella" já usado por outro estabelecimento, **When** o slug é gerado, **Then** recebe um sufixo que o torna único.
5. **Given** um dono que esqueceu a senha, **When** pede recuperação, **Then** recebe link de uso único por e-mail; a resposta é idêntica exista ou não o e-mail; ao redefinir, todas as sessões anteriores são encerradas.

---

### User Story 3 - Admin aprova, recusa, suspende e reativa (Priority: P1)

O administrador da plataforma revisa a fila de cadastros pendentes, aprova (publica) ou recusa com
motivo, e pode suspender ou reativar estabelecimentos ativos.

**Why this priority**: Princípio do produto — nenhum estabelecimento vai ao ar sem aprovação.

**Independent Test**: Um cadastro pendente aprovado passa a aparecer na busca; recusado volta ao dono
com motivo e pode ser reenviado; toda ação gera registro de auditoria.

**Acceptance Scenarios**:

1. **Given** um cadastro `pendente`, **When** aprovado, **Then** vira `ativo`, aparece no marketplace e o dono é notificado.
2. **Given** um cadastro `pendente`, **When** recusado sem motivo, **Then** a ação é rejeitada; com motivo, vira `recusado` e o dono é notificado com o motivo.
3. **Given** um estabelecimento `recusado`, **When** o dono revisa e reenvia, **Then** volta para `pendente`.
4. **Given** um estabelecimento `ativo`, **When** suspenso, **Then** sai do marketplace e não aceita novas reservas; agendamentos já existentes são preservados.
5. **Given** qualquer ação administrativa que altera dados, **Then** fica registrado quem fez, o quê, sobre qual alvo, quando e de onde.
6. **Given** um admin, **When** entra, **Then** precisa de e-mail, senha e código do segundo fator; a sessão expira em no máximo 8 horas.

---

### User Story 4 - Dono opera a agenda do estabelecimento (Priority: P1)

Com o estabelecimento aprovado, o dono vê a agenda por dia ou semana (filtrável por profissional),
confirma, conclui, cancela, marca ausência ou reabre agendamentos, cria agendamentos de balcão,
bloqueia horários e mantém serviços, profissionais e horários de funcionamento.

**Why this priority**: É o valor entregue ao estabelecimento e a fonte da disponibilidade real.

**Independent Test**: Um dono de estabelecimento ativo executa cada transição de status permitida,
cria um bloqueio que some da disponibilidade online e não consegue ler nem alterar nada de outro
estabelecimento.

**Acceptance Scenarios**:

1. **Given** um agendamento `pendente`, **When** o dono confirma, **Then** vira `confirmado` e a cliente é notificada.
2. **Given** um agendamento cujo horário de início ainda não chegou, **When** o dono tenta marcar como concluído ou não compareceu, **Then** a ação é recusada.
3. **Given** um agendamento encerrado (`concluido`, `cancelado` ou `nao_compareceu`), **When** o dono reabre, **Then** volta a `confirmado` somente se o horário ainda estiver livre.
4. **Given** um bloqueio criado sobre horários com agendamentos, **When** criado, **Then** o dono recebe a lista dos agendamentos afetados como aviso; nada é cancelado automaticamente; o período some da disponibilidade online imediatamente.
5. **Given** um agendamento de balcão, **When** criado com nome e WhatsApp da cliente, **Then** só horários livres são aceitos e a origem fica registrada como balcão.
6. **Given** qualquer identificador de recurso de outro estabelecimento, **When** usado pelo dono, **Then** a resposta é "não encontrado".
7. **Given** o limite global de profissionais ativas (padrão 2), **When** o dono tenta ativar uma além do limite, **Then** a ação é recusada.
8. **Given** um serviço marcado como oculto, **Then** ele some do marketplace na hora, mas agendamentos existentes permanecem.
9. **Given** um estabelecimento `pendente`, `recusado` ou `suspenso`, **When** o dono acessa a agenda ou agendamentos, **Then** o acesso operacional é negado; edição de perfil, capa e logo continua permitida (exceto em `suspenso`).

---

### User Story 5 - Cliente acompanha, remarca, cancela e avalia (Priority: P2)

A cliente vê seus próximos agendamentos e o histórico, remarca (mesmas regras de disponibilidade),
cancela dentro do prazo gratuito definido pela plataforma e avalia atendimentos concluídos.

**Why this priority**: Reduz atrito e alimenta a reputação dos estabelecimentos, mas o produto já
entrega valor sem isso.

**Independent Test**: Uma cliente cancela antes do prazo (aceito) e depois dele (recusado), remarca
para outro horário livre e avalia um atendimento concluído uma única vez.

**Acceptance Scenarios**:

1. **Given** prazo de cancelamento de 2h, **When** a cliente cancela 3h antes, **Then** o cancelamento é aceito e o dono é notificado; **When** cancela 1h antes, **Then** é recusado.
2. **Given** um agendamento `confirmado` ou `pendente`, **When** remarcado para outro horário livre, **Then** o mesmo agendamento passa ao novo horário mantendo preço registrado; horário ocupado é recusado.
3. **Given** um agendamento `concluido` da própria cliente, **When** ela avalia (1–5 estrelas, tags de lista fixa, texto opcional), **Then** a avaliação é registrada e a nota média e o número de avaliações do estabelecimento são atualizados; segunda avaliação do mesmo agendamento é recusada.
4. **Given** um agendamento de outra cliente, **When** a cliente tenta ver, remarcar, cancelar ou avaliar, **Then** a resposta é "não encontrado".

---

### User Story 6 - Descoberta de estabelecimentos (Priority: P2)

Qualquer pessoa busca estabelecimentos ativos por nome, serviço ou bairro, filtra por categoria,
bairro e "com horário hoje", ordena por relevância, distância, nota ou menor preço, abre o perfil
público pelo slug, vê destaques escolhidos pela plataforma com os próximos horários livres, e a
cliente logada favorita estabelecimentos.

**Why this priority**: Gera demanda, mas o link próprio do estabelecimento já permite agendar sem a
busca.

**Independent Test**: Com estabelecimentos em vários status, a busca retorna só os ativos de
cidades ativas, ignora acentos, pagina e respeita filtros e ordenação.

**Acceptance Scenarios**:

1. **Given** estabelecimentos `ativo`, `pendente` e `suspenso`, **When** alguém busca, **Then** apenas os `ativo` em cidade ativa aparecem.
2. **Given** a busca "sobrancelha", **When** existe o serviço "Design de Sobrancelhas", **Then** o estabelecimento aparece (sem diferença por acento ou maiúsculas).
3. **Given** um slug de estabelecimento inativo ou inexistente, **When** acessado, **Then** a resposta é "indisponível".
4. **Given** estabelecimentos em destaque, **When** a página inicial é carregada, **Then** cada um traz nota, número de avaliações e até 3 próximos horários livres.
5. **Given** uma cliente logada, **When** favorita e desfavorita, **Then** a lista de favoritos reflete a ação; favoritar duas vezes não duplica.

---

### User Story 7 - Notificações e lembretes (Priority: P2)

Clientes e donos recebem avisos dos eventos relevantes (novo agendamento, mudanças de status,
cancelamentos, remarcações, aprovação/recusa de cadastro) no app; clientes também por WhatsApp; donos
também por e-mail quando o cadastro é decidido. Lembretes 24h e 2h antes e convite para avaliar 2h
após concluir são enviados automaticamente quando ativados pela plataforma.

**Why this priority**: Diminui faltas e mantém as partes informadas, mas a reserva funciona sem isso.

**Independent Test**: Cada evento da tabela de notificações do produto gera a notificação certa para
o destinatário certo; lembretes não são enviados duas vezes; falha de envio externo não desfaz a
operação.

**Acceptance Scenarios**:

1. **Given** um novo agendamento, **Then** a cliente recebe confirmação (app + WhatsApp) e o dono recebe aviso no app marcado como novo.
2. **Given** lembretes ativados, **When** faltam 24h e 2h, **Then** cada lembrete é enviado uma única vez por agendamento ainda ativo.
3. **Given** a falha do provedor de WhatsApp ou e-mail, **When** um evento ocorre, **Then** a operação de negócio permanece gravada e a falha é registrada.
4. **Given** notificações não lidas, **When** o usuário as abre, **Then** são marcadas como lidas e o contador diminui.

---

### User Story 8 - Administração da plataforma e LGPD (Priority: P3)

O admin acompanha indicadores (estabelecimentos ativos, aguardando aprovação, agendamentos na semana,
volume agendado, clientes, taxa de ausência, agendamentos por dia e por categoria, ranking), filtra
por cidade e período, gerencia usuários (bloquear/desbloquear), categorias (criar, editar, ordenar,
ocultar), cidades atendidas, destaques e configurações globais. Usuários podem exportar seus dados e
excluir a conta.

**Why this priority**: Necessário para operar com qualidade, mas o lançamento piloto pode começar com
operações mínimas.

**Independent Test**: O admin bloqueia um usuário (que perde as sessões e não entra mais), altera o
prazo de cancelamento (refletido na regra de cancelamento) e vê indicadores coerentes com os dados.

**Acceptance Scenarios**:

1. **Given** um usuário bloqueado, **Then** suas sessões são encerradas e ele não consegue entrar nem agendar; outro admin não pode ser bloqueado.
2. **Given** uma categoria oculta, **Then** ela some da grade pública e dos filtros.
3. **Given** um usuário que pede exportação, **Then** recebe seus dados pessoais e agendamentos em formato legível por máquina.
4. **Given** uma cliente que exclui a conta, **Then** seus dados pessoais são anonimizados, suas sessões encerradas e os agendamentos permanecem para o estabelecimento como "cliente removida".

---

### Edge Cases

- Profissional fica ocupada entre a consulta de horários e a confirmação em "sem preferência" → outra profissional apta é escolhida ou a reserva falha como horário tomado.
- Profissional desativada com agendamentos futuros → agendamentos permanecem; ela deixa de aparecer na disponibilidade.
- Preço do serviço muda depois da reserva → agendamento mantém o valor registrado.
- Estabelecimento suspenso com agendamentos futuros → permanecem; novas reservas são recusadas.
- Cancelamento exatamente no limite do prazo → aceito até o instante limite, inclusive.
- Virada de dia no fuso de São Paulo → "hoje" e "próximos 7 dias" seguem o calendário local.
- Código de acesso errado repetido → após 3 tentativas o código é invalidado; envios excessivos são limitados por telefone e por IP.
- Usuário bloqueado com sessão aberta → próxima requisição é rejeitada.
- Upload com extensão falsa, SVG ou arquivo acima do limite → recusado antes de qualquer armazenamento.
- Reabertura de agendamento cujo horário já foi ocupado → recusada.
- Bloqueio de dia inteiro → nenhum horário daquela profissional naquele dia fica livre.
- Agendamento de balcão com WhatsApp de cliente já existente → vinculado à mesma cliente.

## Requirements *(mandatory)*

### Functional Requirements

**Autenticação e conta**

- **FR-001**: A cliente MUST entrar ou criar conta informando o telefone e um código de 4 dígitos enviado por WhatsApp, válido por 5 minutos, invalidado após 3 tentativas erradas; reenvio liberado após 30 segundos; no máximo 3 envios a cada 10 minutos por telefone e por IP.
- **FR-002**: A conta da cliente MUST ser criada automaticamente na primeira verificação de telefone, com nome informado por ela.
- **FR-003**: O dono MUST criar conta com nome, e-mail e senha (mínimo 8 caracteres) e MUST confirmar o e-mail por link antes de obter acesso.
- **FR-004**: O dono MUST poder recuperar a senha por link de uso único enviado ao e-mail, válido por 30 minutos; a resposta ao pedido MUST ser idêntica exista ou não a conta; redefinir a senha MUST encerrar todas as sessões.
- **FR-005**: O admin MUST entrar com e-mail, senha e código de segundo fator; contas de admin MUST ser criadas apenas por processo interno; sessões de admin MUST expirar em até 8 horas.
- **FR-006**: O papel do usuário (cliente, dono, admin) MUST ser definido pelo sistema conforme o fluxo de cadastro, nunca por informação enviada pelo usuário.
- **FR-007**: Sessões de cliente e dono MUST expirar após 30 dias sem uso; sair MUST encerrar a sessão no servidor.
- **FR-008**: Tentativas de login MUST ser limitadas por IP e por conta.

**Estabelecimento**

- **FR-010**: Cada dono MUST ter no máximo um estabelecimento, com tipo (salão, barbearia, estúdio, profissional autônoma, estética), nome público, WhatsApp, cidade, bairro, endereço, descrição, coordenadas opcionais e categorias.
- **FR-011**: O sistema MUST gerar um endereço público único (slug) a partir do nome.
- **FR-012**: O dono MUST gerenciar serviços (nome, categoria, duração em múltiplos de 5 minutos, preço, visível no app) — criar, editar, ocultar e excluir (excluir só sem agendamentos; caso contrário, ocultar).
- **FR-013**: O dono MUST gerenciar profissionais (nome, função, foto opcional, serviços que atende) — criar, editar, desativar; o número de profissionais ativas MUST respeitar o limite global vigente.
- **FR-014**: O dono MUST definir horário de funcionamento por dia da semana (abertura, fechamento, pausa de almoço opcional) e dias fechados.
- **FR-015**: O dono MUST enviar capa e logo; somente imagens JPEG, PNG ou WebP verificadas pelo conteúdo, até 5 MB; capa ajustada a até 1600×600 e logo a 512×512; uma nova imagem substitui a anterior.
- **FR-016**: O dono MUST enviar o cadastro para aprovação somente com e-mail verificado, ao menos um serviço visível, uma profissional ativa vinculada a ele e horário definido.
- **FR-017**: O estabelecimento MUST seguir os status `pendente` → `ativo` | `recusado`; `recusado` → `pendente` (reenvio); `ativo` ↔ `suspenso`; qualquer outra transição MUST ser recusada.
- **FR-018**: Funções operacionais (agenda, agendamentos, bloqueios, balcão) MUST estar disponíveis apenas para estabelecimentos `ativo`.
- **FR-019**: O dono MUST poder exigir confirmação manual dos agendamentos vindos do app (desligado por padrão).

**Disponibilidade e agendamento**

- **FR-020**: O sistema MUST listar horários livres por serviço, profissional (ou qualquer apta) e data, de hoje até 6 dias à frente, em intervalos de 15 minutos, no calendário de São Paulo.
- **FR-021**: Um horário MUST ser considerado livre somente se: dentro do expediente; fora da pausa de almoço; sem bloqueio da profissional; sem agendamento `confirmado` ou `pendente` sobreposto; terminando até o fechamento; não estando no passado; profissional ativa e apta ao serviço; serviço visível; estabelecimento ativo.
- **FR-022**: Reservas simultâneas para a mesma profissional em horários sobrepostos MUST resultar em no máximo uma reserva ativa, garantido pelo armazenamento de dados.
- **FR-023**: O agendamento MUST registrar preço e duração do serviço no momento da reserva, origem (app ou balcão) e observações opcionais.
- **FR-024**: Em "sem preferência", a profissional MUST ser escolhida na confirmação entre as aptas e livres, priorizando a com menos agendamentos no dia.
- **FR-025**: A cliente MUST ter telefone verificado para reservar pelo app.
- **FR-026**: A cliente MUST poder remarcar seus agendamentos `confirmado` ou `pendente` sob as mesmas regras de disponibilidade.
- **FR-027**: A cliente MUST poder cancelar somente até o prazo gratuito global (1h, 2h, 6h ou 24h antes do início).
- **FR-028**: O dono MUST aplicar as transições: `pendente`→`confirmado`; `confirmado`|`pendente`→`cancelado`; `confirmado`→`concluido` ou `nao_compareceu` (somente após o início); encerrado→`confirmado` (reabrir, somente com horário livre).
- **FR-029**: O dono MUST criar agendamento de balcão (nome e WhatsApp da cliente, sem código), reaproveitando a cliente pelo telefone quando existir.
- **FR-030**: O dono MUST criar bloqueios (1h, 2h, 4h ou dia inteiro, com motivo: compromisso, folga, almoço estendido, curso), listar e removê-los; ao criar, MUST receber os agendamentos sobrepostos como aviso.
- **FR-031**: O dono MUST consultar a agenda por dia ou semana com filtro por profissional, a visão geral do dia (agendamentos hoje, receita prevista, aguardando ação, novos e pendentes) e a lista de clientes que já agendaram.

**Descoberta e reputação**

- **FR-040**: Consultas públicas MUST retornar apenas estabelecimentos `ativo` de cidades ativas; perfis de outros status MUST responder "indisponível".
- **FR-041**: A busca MUST aceitar texto livre (nome, serviço, bairro) sem diferenciar acentos e maiúsculas, filtros (categoria, bairro, com horário hoje) e ordenações (relevância, distância quando houver coordenadas, melhor avaliados, menor preço), com paginação de no máximo 50 itens.
- **FR-042**: O perfil público MUST expor serviços visíveis, profissionais ativas, avaliações, descrição, tipo, horários, endereço, telefone, nota, número de avaliações, "aberto agora" e próximo horário livre.
- **FR-043**: Destaques MUST ser definidos pelo admin e trazer até 3 próximos horários livres.
- **FR-044**: A cliente MUST favoritar e desfavoritar estabelecimentos e listar favoritos.
- **FR-045**: A cliente MUST avaliar uma única vez cada agendamento próprio `concluido` (1–5 estrelas, tags: Pontual, Atenciosa, Ambiente limpo, Ótimo resultado, Preço justo; texto até 500 caracteres); nota média e contagem MUST ser atualizadas de forma consistente.

**Notificações**

- **FR-050**: O sistema MUST manter notificações no app por usuário, com contagem de não lidas e marcação como lidas.
- **FR-051**: O sistema MUST notificar conforme a tabela de eventos de `docs/mvp-spec.md` §8 (canais: app, WhatsApp, e-mail).
- **FR-052**: Envios externos MUST ocorrer após a gravação da operação e falhas MUST ser registradas sem desfazer nem repetir a operação.
- **FR-053**: Lembretes 24h e 2h antes e convite para avaliar 2h após a conclusão MUST ser enviados automaticamente, uma única vez, quando ativados nas configurações globais.

**Administração**

- **FR-060**: O admin MUST ver a fila de aprovação com dados completos do cadastro e do responsável, aprovar ou recusar (motivo obrigatório).
- **FR-061**: O admin MUST listar estabelecimentos (nome, dono, tipo, bairro, nota, status, destaque), suspender, reativar e marcar/desmarcar destaque.
- **FR-062**: O admin MUST listar usuários por papel com contagens e bloquear/desbloquear clientes e donos (nunca admins); bloquear MUST encerrar as sessões.
- **FR-063**: O admin MUST gerenciar categorias (nome, ícone, ordem, visível no app) e cidades atendidas (ativar/desativar).
- **FR-064**: O admin MUST editar configurações globais: prazo de cancelamento (1h, 2h, 6h, 24h), lembretes automáticos, convite para avaliar, limite de profissionais ativas por estabelecimento. A aprovação obrigatória de estabelecimentos MUST ser permanente e não editável.
- **FR-065**: O admin MUST ver indicadores por cidade e período: estabelecimentos ativos, aguardando aprovação, agendamentos na semana, volume agendado (R$), clientes, taxa de ausência, agendamentos por dia e por categoria, ranking dos mais agendados.
- **FR-066**: O admin MUST ter leitura da agenda de qualquer estabelecimento.
- **FR-067**: Toda ação administrativa que altera dados MUST ser registrada em auditoria (autor, ação, alvo, resumo da mudança, data e origem).

**Privacidade (LGPD)**

- **FR-070**: O consentimento da cliente para receber mensagens por WhatsApp MUST ser registrado no pedido de código.
- **FR-071**: Usuários MUST poder exportar seus dados pessoais e agendamentos.
- **FR-072**: Usuários MUST poder excluir a conta; dados pessoais são anonimizados e agendamentos preservados para o estabelecimento. Dono com estabelecimento ativo precisa antes pedir a suspensão.

**Segurança (transversal)**

- **FR-080**: Toda entrada externa MUST ser validada e campos não previstos MUST ser rejeitados.
- **FR-081**: O estabelecimento do dono MUST ser determinado pela sessão; recursos de outro estabelecimento MUST responder "não encontrado".
- **FR-082**: Rotas sensíveis (login, código, recuperação, reserva, busca) MUST ter limite de requisições com resposta genérica.
- **FR-083**: Erros MUST seguir um formato padrão sem detalhes internos; logs MUST omitir senhas, tokens, códigos e cookies e mascarar telefone e e-mail.
- **FR-084**: Respostas MUST conter apenas os campos necessários; nunca hashes, tokens ou segredos.
- **FR-085**: A documentação interativa da API MUST ficar indisponível em produção.

### Key Entities

- **Usuário**: pessoa com papel (cliente, dono, admin), status (ativo, bloqueado), nome, telefone e/ou e-mail verificados, consentimento de WhatsApp.
- **Sessão / Verificação**: acesso autenticado com expiração; códigos e links temporários de verificação e recuperação.
- **Cidade**: cidade atendida, ativa ou não (Goiânia na largada).
- **Categoria**: tipo de serviço exibido na grade (nome, ícone, ordem, visível).
- **Estabelecimento**: pertence a um dono e a uma cidade; tipo, nome, slug, contato, endereço, bairro, coordenadas, capa, logo, status, motivo de recusa, destaque, exige confirmação, nota média, número de avaliações.
- **Horário de funcionamento**: por dia da semana, abertura, fechamento, almoço.
- **Serviço**: do estabelecimento; categoria, duração, preço, visível.
- **Profissional**: do estabelecimento; nome, função, foto, ativa, serviços que atende.
- **Agendamento**: cliente, estabelecimento, profissional, serviço, início, fim, preço e duração registrados, status, origem, observações, marcas de lembrete enviado.
- **Bloqueio**: profissional, início, fim, motivo.
- **Avaliação**: um por agendamento concluído; nota, tags, texto.
- **Favorito**: cliente × estabelecimento.
- **Notificação**: destinatário, tipo, conteúdo, lida.
- **Configuração global**: prazo de cancelamento, lembretes, convite para avaliar, limite de profissionais.
- **Registro de auditoria**: autor, ação, alvo, resumo, origem, data.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Em 50 tentativas simultâneas para o mesmo horário e profissional, exatamente 1 reserva é criada (0 reservas duplicadas).
- **SC-002**: 100% das operações do painel do dono recusam acesso a recursos de outro estabelecimento.
- **SC-003**: Nenhum horário exibido como livre é recusado na confirmação por regra de disponibilidade (somente por concorrência real).
- **SC-004**: A cliente conclui uma reserva, incluindo verificação do telefone, em menos de 2 minutos quando os envios funcionam.
- **SC-005**: A consulta de horários livres de um dia responde em menos de 1 segundo para estabelecimentos com até 10 profissionais.
- **SC-006**: 100% das ações administrativas que alteram dados geram registro de auditoria.
- **SC-007**: Nenhum estabelecimento não aprovado aparece em busca, destaque ou perfil público.
- **SC-008**: Falhas de provedores externos não causam perda nem duplicação de nenhuma operação de negócio.

## Assumptions

- Somente o plano Free existe no MVP: não há cobrança, assinatura, fatura ou reembolso; o limite de profissionais ativas é uma configuração global (padrão 2, conforme o plano Free do produto).
- Pagamento do serviço é sempre no local; nenhum valor é transacionado pela plataforma.
- O provedor de WhatsApp ainda não foi contratado; no MVP as mensagens são registradas por um adaptador substituível, sem afetar regras de negócio.
- Uma única instância do backend atende o piloto em Goiânia; o fuso de todas as regras de calendário é `America/Sao_Paulo`.
- Um dono possui um único estabelecimento (múltiplas unidades fora do MVP).
- Distância só é calculada quando o estabelecimento tem coordenadas e o cliente envia sua localização.
- Atualização de notificações no app é feita por consulta periódica do frontend (sem tempo real).
- Decisões técnicas (stack, provedores de autenticação, e-mail e imagens) estão em `project.config.json` e serão detalhadas no `plan.md`.
- Fora do escopo: tudo listado em `docs/mvp-spec.md` §12, além de pagamento online, planos pagos e frontend.
