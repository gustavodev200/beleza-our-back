import {
  businessFixture,
  clientSession,
  emailClientSession,
  HttpClient,
  prisma,
  readOutbox,
  spInstant,
  waitFor,
  uniquePhone,
  workday,
} from './helpers';
import { CRON_SECRET } from './test-env';

const fakeSubscription = (tag: string) => ({
  endpoint: `https://push.example.test/${tag}-${Date.now()}`,
  keys: { p256dh: 'BPk-test-key', auth: 'auth-test' },
  expirationTime: null,
});

afterAll(() => prisma.$disconnect());

describe('Notificações e lembretes (US7)', () => {
  it('novo agendamento notifica cliente (app + WhatsApp) e dono (app)', async () => {
    const fx = await businessFixture();
    const client = await clientSession();
    const res = await client.http.post('/appointments', {
      businessId: fx.business.id,
      serviceId: fx.serviceId,
      startsAt: spInstant(workday(1), '09:00'),
      clientName: 'Bruna',
      whatsappConsent: true,
    });
    expect(res.status).toBe(201);

    const unread = await client.http.get('/me/notifications/unread-count');
    expect(unread.body.count).toBeGreaterThanOrEqual(1);
    const ownerList = await fx.owner.http.get('/me/notifications');
    expect(ownerList.body.items.some((n: { type: string }) => n.type === 'NEW_APPOINTMENT')).toBe(
      true,
    );
    await waitFor(() =>
      readOutbox().find(
        (m) =>
          m.channel === 'whatsapp' &&
          m.to === client.phone &&
          /horário confirmado/i.test(m.text ?? ''),
      ),
    );

    const read = await client.http.post('/me/notifications/read', {});
    expect(read.body.updated).toBeGreaterThanOrEqual(1);
    expect((await client.http.get('/me/notifications/unread-count')).body.count).toBe(0);
  });

  it('lembretes 24h e 2h saem uma única vez', async () => {
    const fx = await businessFixture();
    const client = await clientSession();
    const res = await client.http.post('/appointments', {
      businessId: fx.business.id,
      serviceId: fx.serviceId,
      startsAt: spInstant(workday(2), '10:00'),
      clientName: 'Carla',
      whatsappConsent: true,
    });
    // Aproxima o atendimento para dentro das duas janelas e zera as marcas.
    await prisma.appointment.update({
      where: { id: res.body.id },
      data: {
        startsAt: new Date(Date.now() + 90 * 60_000),
        endsAt: new Date(Date.now() + 150 * 60_000),
        reminder24hSentAt: null,
        reminder2hSentAt: null,
      },
    });
    const reminders = () =>
      readOutbox().filter(
        (m) => m.channel === 'whatsapp' && m.to === client.phone && /lembrete/i.test(m.text ?? ''),
      );
    await waitFor(() => (reminders().length >= 2 ? true : undefined), 10_000);
    await new Promise((r) => setTimeout(r, 2500)); // mais algumas execuções do agendador
    expect(reminders()).toHaveLength(2);
    const stored = await prisma.appointment.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(stored.reminder24hSentAt).not.toBeNull();
    expect(stored.reminder2hSentAt).not.toBeNull();
  });

  it('convite para avaliar sai 2h após concluir, uma vez', async () => {
    const fx = await businessFixture();
    const client = await clientSession();
    const res = await client.http.post('/appointments', {
      businessId: fx.business.id,
      serviceId: fx.serviceId,
      startsAt: spInstant(workday(3), '10:00'),
      clientName: 'Dani',
      whatsappConsent: true,
    });
    await prisma.appointment.update({
      where: { id: res.body.id },
      data: { status: 'COMPLETED', completedAt: new Date(Date.now() - 3 * 3_600_000) },
    });
    const invite = await waitFor(
      () =>
        prisma.notification
          .findFirst({ where: { userId: client.userId, type: 'REVIEW_INVITE' } })
          .then((n) => n ?? undefined),
      10_000,
    );
    expect(invite.title).toMatch(/Avalie/);
  });

  it('sem consentimento, nada vai para o WhatsApp (só in-app)', async () => {
    const fx = await businessFixture();
    const client = await clientSession();
    await client.http.post('/appointments', {
      businessId: fx.business.id,
      serviceId: fx.serviceId,
      startsAt: spInstant(workday(4), '10:00'),
      clientName: 'Eva',
      whatsappConsent: true,
    });
    await client.http.patch('/me', { whatsappConsent: false });
    const before = readOutbox().length;
    const second = await client.http.get('/me');
    expect(second.body.whatsappConsent).toBe(false);
    const appointment = await prisma.appointment.findFirstOrThrow({
      where: { clientId: client.userId },
    });
    await fx.owner.http.post(`/owner/appointments/${appointment.id}/cancel`);
    await new Promise((r) => setTimeout(r, 300));
    expect(
      readOutbox()
        .slice(before)
        .filter((m) => m.to === client.phone),
    ).toHaveLength(0);
    const inApp = await prisma.notification.findFirst({
      where: { userId: client.userId, type: 'APPOINTMENT_CANCELED' },
    });
    expect(inApp).not.toBeNull();
  });

  it('lembrete 15 min antes e na hora: cliente e dono, app + e-mail + push, uma vez', async () => {
    const fx = await businessFixture();
    const client = await emailClientSession();
    expect(
      (await client.http.post('/me/push-subscriptions', fakeSubscription('client'))).status,
    ).toBe(204);
    expect(
      (await fx.owner.http.post('/me/push-subscriptions', fakeSubscription('owner'))).status,
    ).toBe(204);
    const res = await client.http.post('/appointments', {
      businessId: fx.business.id,
      serviceId: fx.serviceId,
      startsAt: spInstant(workday(5), '10:00'),
      clientName: 'Fernanda',
      clientPhone: uniquePhone(),
      whatsappConsent: true,
    });
    expect(res.status).toBe(201);
    const id = res.body.id as string;
    const shift = (minutes: number) =>
      prisma.appointment.update({
        where: { id },
        data: {
          startsAt: new Date(Date.now() + minutes * 60_000),
          endsAt: new Date(Date.now() + (minutes + 60) * 60_000),
          reminder24hSentAt: new Date(),
          reminder2hSentAt: new Date(),
        },
      });
    const types = async (userId: string) =>
      (await prisma.notification.findMany({ where: { userId }, select: { type: true } })).map(
        (n) => n.type,
      );

    await shift(10);
    await waitFor(
      async () =>
        (await types(fx.owner.userId)).includes('OWNER_REMINDER_15M') ? true : undefined,
      10_000,
    );
    expect(await types(client.userId)).toContain('APPOINTMENT_REMINDER_15M');
    expect(await types(client.userId)).not.toContain('APPOINTMENT_REMINDER_NOW');

    await shift(0);
    await waitFor(
      async () =>
        (await types(client.userId)).includes('APPOINTMENT_REMINDER_NOW') ? true : undefined,
      10_000,
    );
    await waitFor(
      async () =>
        (await types(fx.owner.userId)).includes('OWNER_REMINDER_NOW') ? true : undefined,
      10_000,
    );
    await new Promise((r) => setTimeout(r, 2500)); // mais execuções do agendador

    const clientTypes = await types(client.userId);
    expect(clientTypes.filter((t) => t === 'APPOINTMENT_REMINDER_15M')).toHaveLength(1);
    expect(clientTypes.filter((t) => t === 'APPOINTMENT_REMINDER_NOW')).toHaveLength(1);
    const outbox = readOutbox();
    const emails = (to: string) =>
      outbox.filter((m) => m.channel === 'email' && m.to === to).map((m) => m.subject);
    expect(emails(client.email).filter((s) => /15 minutos/.test(s ?? ''))).toHaveLength(1);
    expect(emails(client.email).filter((s) => /Chegou a hora/.test(s ?? ''))).toHaveLength(1);
    expect(emails(fx.owner.email).filter((s) => /Atendimento em 15/.test(s ?? ''))).toHaveLength(1);
    expect(emails(fx.owner.email).filter((s) => /começando agora/.test(s ?? ''))).toHaveLength(1);
    const pushes = (userId: string) =>
      outbox.filter((m) => m.channel === 'push' && m.userId === userId);
    expect(pushes(client.userId).some((m) => m.url === '/appointments')).toBe(true);
    expect(pushes(fx.owner.userId).some((m) => m.url === '/dashboard/schedule')).toBe(true);
  });

  it('inscrição push: chave pública, cadastro e remoção só pelo dono do aparelho', async () => {
    const anon = new HttpClient();
    const key = await anon.get('/push/public-key');
    expect(key.status).toBe(200);
    expect(key.body).toHaveProperty('publicKey');
    const sub = fakeSubscription('anon');
    expect((await anon.post('/me/push-subscriptions', sub)).status).toBe(401);

    const a = await emailClientSession();
    const b = await emailClientSession();
    expect((await a.http.post('/me/push-subscriptions', sub)).status).toBe(204);
    expect(
      (await a.http.post('/me/push-subscriptions', { endpoint: 'http://inseguro', keys: sub.keys }))
        .status,
    ).toBe(400);
    await b.http.request('DELETE', '/me/push-subscriptions', { endpoint: sub.endpoint });
    expect(await prisma.pushSubscription.count({ where: { endpoint: sub.endpoint } })).toBe(1);
    await a.http.request('DELETE', '/me/push-subscriptions', { endpoint: sub.endpoint });
    expect(await prisma.pushSubscription.count({ where: { endpoint: sub.endpoint } })).toBe(0);
  });

  it('cron externo exige o segredo e devolve o resumo do tick', async () => {
    const http = new HttpClient();
    expect((await http.post('/internal/cron/tick')).status).toBe(401);
    expect(
      (
        await http.request('POST', '/internal/cron/tick', undefined, {
          Authorization: 'Bearer errado',
        })
      ).status,
    ).toBe(401);
    const ok = await http.request('POST', '/internal/cron/tick', undefined, {
      Authorization: `Bearer ${CRON_SECRET}`,
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toHaveProperty('startNotices');
  });
});
