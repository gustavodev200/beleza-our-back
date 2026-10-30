import {
  HttpClient,
  businessFixture,
  clientSession,
  emailClientSession,
  nextWeekday,
  uniquePhone,
  workday,
  prisma,
  spInstant,
} from './helpers';

afterAll(() => prisma.$disconnect());

const MONDAY = () => workday(1);
type Fixture = Awaited<ReturnType<typeof businessFixture>>;

function bookBody(fx: Fixture, startsAt: string, extra: Record<string, unknown> = {}) {
  return {
    businessId: fx.business.id,
    serviceId: fx.serviceId,
    startsAt,
    clientName: 'Joana Cliente',
    whatsappConsent: true,
    ...extra,
  };
}

describe('Disponibilidade e reserva (US1)', () => {
  it('lista horários livres respeitando expediente e almoço', async () => {
    const fx = await businessFixture();
    const date = MONDAY();
    const res = await new HttpClient().get(
      `/businesses/${fx.business.slug}/availability?serviceId=${fx.serviceId}&date=${date}`,
    );
    expect(res.status).toBe(200);
    const starts: string[] = res.body.slots.map((s: { startsAt: string }) => s.startsAt);
    expect(starts).toContain(spInstant(date, '09:00'));
    expect(starts).not.toContain(spInstant(date, '11:30'));
    expect(starts).not.toContain(spInstant(date, '17:15'));
    expect(res.body.slots[0].professionalIds).toHaveLength(2);
  });

  it('domingo (fechado) e data fora da janela não têm horários', async () => {
    const fx = await businessFixture();
    const base = `/businesses/${fx.business.slug}/availability?serviceId=${fx.serviceId}`;
    const sunday = await new HttpClient().get(`${base}&date=${nextWeekday(0)}`);
    expect(sunday.body.slots).toEqual([]);
    const far = await new HttpClient().get(`${base}&date=2099-01-01`);
    expect(far.status).toBe(422);
  });

  it('reserva com preço e duração congelados; mudança de preço não afeta', async () => {
    const fx = await businessFixture();
    const client = await clientSession();
    const res = await client.http.post('/appointments', bookBody(fx, spInstant(MONDAY(), '10:00')));
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('CONFIRMED');
    expect(res.body.priceCents).toBe(5000);
    expect(res.body.durationMinutes).toBe(60);

    await fx.owner.http.patch(`/owner/services/${fx.serviceId}`, { priceCents: 9900 });
    const again = await client.http.get(`/me/appointments/${res.body.id}`);
    expect(again.body.priceCents).toBe(5000);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: client.userId } });
    expect(user.name).toBe('Joana Cliente');
    expect(user.whatsappConsentAt).not.toBeNull();
  });

  it('estabelecimento que exige confirmação gera PENDING', async () => {
    const fx = await businessFixture({ requiresConfirmation: true });
    const client = await clientSession();
    const res = await client.http.post('/appointments', bookBody(fx, spInstant(MONDAY(), '14:00')));
    expect(res.body.status).toBe('PENDING');
  });

  it('recusa horário fora da grade (SLOT_UNAVAILABLE) e ocupado (SLOT_TAKEN)', async () => {
    const fx = await businessFixture();
    const client = await clientSession();
    const lunch = await client.http.post(
      '/appointments',
      bookBody(fx, spInstant(MONDAY(), '12:00')),
    );
    expect(lunch.status).toBe(422);
    expect(lunch.body.code).toBe('SLOT_UNAVAILABLE');

    const startsAt = spInstant(MONDAY(), '15:00');
    const [ana] = fx.professionalIds;
    expect(
      (await client.http.post('/appointments', bookBody(fx, startsAt, { professionalId: ana })))
        .status,
    ).toBe(201);
    const taken = await client.http.post(
      '/appointments',
      bookBody(fx, startsAt, { professionalId: ana }),
    );
    expect(taken.status).toBe(409);
    expect(taken.body.code).toBe('SLOT_TAKEN');
  });

  it('sem preferência atribui a profissional livre', async () => {
    const fx = await businessFixture();
    const client = await clientSession();
    const startsAt = spInstant(MONDAY(), '16:00');
    const [ana, bia] = fx.professionalIds;
    await client.http.post('/appointments', bookBody(fx, startsAt, { professionalId: ana }));
    const any = await client.http.post('/appointments', bookBody(fx, startsAt));
    expect(any.status).toBe(201);
    expect(any.body.professional.id).toBe(bia);
    const none = await client.http.post('/appointments', bookBody(fx, startsAt));
    expect(none.body.code).toBe('SLOT_TAKEN');
  });

  it('exige consentimento, papel CLIENT e estabelecimento ativo', async () => {
    const fx = await businessFixture();
    const client = await clientSession();
    const at9 = spInstant(MONDAY(), '09:00');
    expect(
      (await client.http.post('/appointments', bookBody(fx, at9, { whatsappConsent: false })))
        .status,
    ).toBe(400);
    expect((await fx.owner.http.post('/appointments', bookBody(fx, at9))).status).toBe(403);
    expect((await new HttpClient().post('/appointments', bookBody(fx, at9))).status).toBe(401);

    const pending = await businessFixture({ activate: false });
    expect((await client.http.post('/appointments', bookBody(pending, at9))).status).toBe(404);
  });

  it('telefone não verificado não reserva', async () => {
    const fx = await businessFixture();
    const client = await clientSession();
    await prisma.user.update({
      where: { id: client.userId },
      data: { phoneNumberVerified: false },
    });
    const res = await client.http.post('/appointments', bookBody(fx, spInstant(MONDAY(), '09:00')));
    expect(res.body.code).toBe('PHONE_NOT_VERIFIED');
  });

  it('cliente por e-mail reserva informando o WhatsApp, que fica na conta', async () => {
    const fx = await businessFixture();
    const client = await emailClientSession();
    const at = spInstant(MONDAY(), '09:00');

    const noPhone = await client.http.post('/appointments', bookBody(fx, at));
    expect(noPhone.status).toBe(422);
    expect(noPhone.body.code).toBe('PHONE_REQUIRED');

    const phone = uniquePhone();
    const res = await client.http.post('/appointments', bookBody(fx, at, { clientPhone: phone }));
    expect(res.status).toBe(201);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: client.userId } });
    expect(user.phoneNumber).toBe(phone);
    expect(user.phoneNumberVerified).toBe(false);

    // Com telefone na conta, não precisa mandar de novo.
    const again = await client.http.post(
      '/appointments',
      bookBody(fx, spInstant(MONDAY(), '10:00')),
    );
    expect(again.status).toBe(201);
  });

  it('cliente por e-mail não usa WhatsApp de outra conta', async () => {
    const fx = await businessFixture();
    const other = await clientSession();
    const client = await emailClientSession();
    const res = await client.http.post(
      '/appointments',
      bookBody(fx, spInstant(MONDAY(), '09:00'), { clientPhone: other.phone }),
    );
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PHONE_IN_USE');
  });
});
