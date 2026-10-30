# Notificações, lembretes e cron

## O que sai e quando

| Momento | Cliente | Dono | Canais |
|---|:-:|:-:|---|
| 24h e 2h antes | ✔ | — | WhatsApp (provedor ainda não contratado: só log) |
| 15 min antes | ✔ | ✔ | E-mail + push (PWA) + sino in-app |
| Na hora marcada | ✔ | ✔ | E-mail + push (PWA) + sino in-app |
| Demais eventos (novo agendamento, confirmação, cancelamento…) | conforme `mvp-spec.md` §8 | | in-app **+ push** |

- Só agendamentos `CONFIRMED`. Toggle **Lembretes automáticos** em Admin → Configurações liga/desliga todos.
- E-mail só para endereço verificado (cliente criada no balcão não recebe e-mail).
- Cada lembrete sai uma vez (`reminder_15m_sent_at`, `start_notice_sent_at`). "Na hora" sai a partir de 1 min antes; se a API ficou fora do ar, ainda sai até 10 min depois do início, depois disso é descartado.

## Agendador

`NotificationsScheduler.tick()` roda:

1. **Dentro da API**, a cada `SCHEDULER_INTERVAL_MS` (padrão 60 s) e logo ao subir.
2. **Por cron externo**: `POST /api/internal/cron/tick` com `Authorization: Bearer <CRON_SECRET>`. Devolve o resumo (`{ startNotices, reminders15m, ... }`). Sem `CRON_SECRET` a rota responde 404.

No Render free a instância **dorme após 15 min sem tráfego** e o agendador interno para junto. Por isso há um pinger externo:

- **GitHub Actions** (`.github/workflows/cron-tick.yml`, já no repo): a cada 5 min. Sem secret, só bate em `/api/health` (mantém acordada); com o secret `CRON_SECRET` no repositório, chama o tick. Atrasos do GitHub são comuns e o agendamento é desativado após 60 dias sem commits no repo.
- **cron-job.org (recomendado, grátis, 1 min)**: crie um job
  - URL: `https://beleza-our-back.onrender.com/api/internal/cron/tick`
  - Método: `POST`; cabeçalho `Authorization: Bearer <CRON_SECRET>`
  - Agenda: a cada minuto; timeout: o máximo permitido.

Manter a instância sempre acordada consome ~744 h/mês das 750 h grátis do workspace do Render: não suba outro web service free no mesmo workspace.

## Variáveis (Render → beleza-our-back → Environment)

| Variável | Para quê |
|---|---|
| `RESEND_API_KEY` | Envio de e-mail. Vazia = e-mail só no log. |
| `EMAIL_FROM` | Remetente. O domínio precisa estar **verificado no Resend** (sem domínio próprio, use `onboarding@resend.dev`, que só entrega para o e-mail da conta Resend). |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Web Push. Gerar com `npx web-push generate-vapid-keys`. Trocar o par invalida todas as inscrições (usuários precisam reativar). |
| `VAPID_SUBJECT` | `mailto:` de contato exigido pelos serviços de push. |
| `CRON_SECRET` | Segredo do cron externo (≥ 32 caracteres, `openssl rand -hex 32`). |

O front não tem variável nova: pega a chave pública em `GET /api/push/public-key`.

## Push no aparelho

- Cliente: card em **Notificações**. Dono: card na **Visão geral** do painel e em **Minha agenda**.
- iPhone: push só com o app adicionado à Tela de Início (iOS 16.4+).
- Ao sair da conta, a inscrição do aparelho é removida.
