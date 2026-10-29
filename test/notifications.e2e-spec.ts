import {
  businessFixture,
  clientSession,
  prisma,
  readOutbox,
  spInstant,
  waitFor,
  workday,
} from './helpers';

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
});
