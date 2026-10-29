import {
  HttpClient,
  businessFixture,
  clientSession,
  workday,
  prisma,
  spInstant,
  uniquePhone,
} from './helpers';

afterAll(() => prisma.$disconnect());

type Fixture = Awaited<ReturnType<typeof businessFixture>>;

async function book(fx: Fixture, startsAt: string, professionalId?: string) {
  const client = await clientSession();
  const res = await client.http.post('/appointments', {
    businessId: fx.business.id,
    serviceId: fx.serviceId,
    professionalId,
    startsAt,
    clientName: 'Maria',
    whatsappConsent: true,
  });
  expect(res.status).toBe(201);
  return { client, appointment: res.body as { id: string } };
}

describe('Agenda do dono (US4)', () => {
  it('confirma pendente e notifica a cliente; não conclui antes do início', async () => {
    const fx = await businessFixture({ requiresConfirmation: true });
    const { client, appointment } = await book(fx, spInstant(workday(1), '09:00'));

    const confirmed = await fx.owner.http.post(`/owner/appointments/${appointment.id}/confirm`);
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.status).toBe('CONFIRMED');
    const n = await prisma.notification.findFirst({
      where: { userId: client.userId, type: 'APPOINTMENT_CONFIRMED' },
    });
    expect(n).not.toBeNull();

    const early = await fx.owner.http.post(`/owner/appointments/${appointment.id}/complete`);
    expect(early.status).toBe(422);
    expect(early.body.code).toBe('APPOINTMENT_NOT_STARTED');
    expect((await fx.owner.http.post(`/owner/appointments/${appointment.id}/explode`)).status).toBe(
      404,
    );
  });

  it('conclui após o início, reabre e só reabre se o horário estiver livre', async () => {
    const fx = await businessFixture();
    const [ana] = fx.professionalIds;
    const { appointment } = await book(fx, spInstant(workday(2), '10:00'), ana);
    // Simula atendimento já iniciado.
    await prisma.appointment.update({
      where: { id: appointment.id },
      data: {
        startsAt: new Date(Date.now() - 2 * 3_600_000),
        endsAt: new Date(Date.now() - 3_600_000),
      },
    });
    expect(
      (await fx.owner.http.post(`/owner/appointments/${appointment.id}/complete`)).body.status,
    ).toBe('COMPLETED');
    expect(
      (await fx.owner.http.post(`/owner/appointments/${appointment.id}/reopen`)).body.status,
    ).toBe('CONFIRMED');
    expect(
      (await fx.owner.http.post(`/owner/appointments/${appointment.id}/no-show`)).body.status,
    ).toBe('NO_SHOW');

    const future = await book(fx, spInstant(workday(2), '14:00'), ana);
    await fx.owner.http.post(`/owner/appointments/${future.appointment.id}/cancel`);
    await book(fx, spInstant(workday(2), '14:00'), ana);
    const reopen = await fx.owner.http.post(`/owner/appointments/${future.appointment.id}/reopen`);
    expect(reopen.status).toBe(409);
    expect(reopen.body.code).toBe('SLOT_TAKEN');
  });

  it('balcão: só horário livre, origem COUNTER, reaproveita cliente pelo telefone', async () => {
    const fx = await businessFixture();
    const phone = uniquePhone();
    const startsAt = spInstant(workday(3), '09:00');
    const body = {
      clientName: 'Rita',
      clientPhone: phone,
      serviceId: fx.serviceId,
      professionalId: fx.professionalIds[0],
      startsAt,
    };
    const first = await fx.owner.http.post('/owner/appointments', body);
    expect(first.status).toBe(201);
    expect(first.body.origin).toBe('COUNTER');
    expect((await fx.owner.http.post('/owner/appointments', body)).status).toBe(409);

    const second = await fx.owner.http.post('/owner/appointments', {
      ...body,
      professionalId: fx.professionalIds[1],
    });
    expect(second.body.client.id).toBe(first.body.client.id);

    // A cliente de balcão entra depois pelo código e encontra o agendamento.
    const client = await clientSession(phone);
    const mine = await client.http.get('/me/appointments');
    expect(mine.body.items.length).toBe(2);
  });

  it('bloqueio devolve conflitos, remove horários da disponibilidade e pode ser apagado', async () => {
    const fx = await businessFixture();
    const [ana] = fx.professionalIds;
    const date = workday(4);
    await book(fx, spInstant(date, '15:00'), ana);

    const blocked = await fx.owner.http.post('/owner/blocks', {
      professionalId: ana,
      date,
      start: '14:00',
      duration: '2h',
      reason: 'COURSE',
    });
    expect(blocked.status).toBe(201);
    expect(blocked.body.conflicts).toHaveLength(1);

    const slots = await new HttpClient().get(
      `/businesses/${fx.business.slug}/availability?serviceId=${fx.serviceId}&date=${date}&professionalId=${ana}`,
    );
    const starts = slots.body.slots.map((s: { startsAt: string }) => s.startsAt);
    expect(starts).not.toContain(spInstant(date, '14:00'));
    expect(starts).toContain(spInstant(date, '16:00'));

    const dayOff = await fx.owner.http.post('/owner/blocks', {
      professionalId: ana,
      date,
      duration: 'day',
      reason: 'DAY_OFF',
    });
    const none = await new HttpClient().get(
      `/businesses/${fx.business.slug}/availability?serviceId=${fx.serviceId}&date=${date}&professionalId=${ana}`,
    );
    expect(none.body.slots).toEqual([]);
    expect((await fx.owner.http.delete(`/owner/blocks/${dayOff.body.block.id}`)).status).toBe(204);
  });

  it('visão geral, agenda e clientes', async () => {
    const fx = await businessFixture({ requiresConfirmation: true });
    const date = workday(5);
    await book(fx, spInstant(date, '09:00'));
    const overview = await fx.owner.http.get('/owner/overview');
    expect(overview.status).toBe(200);
    expect(overview.body.awaitingAction).toBe(1);
    expect(overview.body.newAndPending).toHaveLength(1);

    const agenda = await fx.owner.http.get(`/owner/agenda?from=${date}&to=${date}`);
    expect(agenda.body.appointments).toHaveLength(1);
    expect(agenda.body.professionals).toHaveLength(2);
    expect((await fx.owner.http.get(`/owner/agenda?from=${date}&to=2099-01-01`)).status).toBe(422);

    const clients = await fx.owner.http.get('/owner/clients');
    expect(clients.body.total).toBe(1);
    expect(clients.body.items[0].appointmentsCount).toBe(1);
  });

  it('estabelecimento não aprovado não opera a agenda', async () => {
    const fx = await businessFixture({ activate: false });
    const res = await fx.owner.http.get('/owner/overview');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('BUSINESS_NOT_ACTIVE');
  });
});
