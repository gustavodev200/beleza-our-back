import { businessFixture, clientSession, prisma, spInstant, workday } from './helpers';

afterAll(() => prisma.$disconnect());

describe('LGPD (FR-071, FR-072)', () => {
  it('exporta dados sem segredos', async () => {
    const fx = await businessFixture();
    const client = await clientSession();
    await client.http.post('/appointments', {
      businessId: fx.business.id,
      serviceId: fx.serviceId,
      startsAt: spInstant(workday(1), '09:00'),
      clientName: 'Gabi',
      whatsappConsent: true,
    });
    const res = await client.http.get('/me/export');
    expect(res.status).toBe(200);
    expect(res.body.profile.phoneNumber).toBe(client.phone);
    expect(res.body.appointments).toHaveLength(1);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toMatch(/password|secret|token/i);
  });

  it('exclusão anonimiza, encerra sessão e preserva o agendamento para o estabelecimento', async () => {
    const fx = await businessFixture();
    const client = await clientSession();
    const booked = await client.http.post('/appointments', {
      businessId: fx.business.id,
      serviceId: fx.serviceId,
      startsAt: spInstant(workday(2), '09:00'),
      clientName: 'Helena Souza',
      whatsappConsent: true,
    });
    expect((await client.http.delete('/me')).status).toBe(204);
    expect((await client.http.get('/me')).status).toBe(401);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: client.userId } });
    expect(user.phoneNumber).toBeNull();
    expect(user.name).toBe('Cliente removida');
    expect(user.anonymizedAt).not.toBeNull();

    const appointment = await fx.owner.http.get(`/owner/appointments/${booked.body.id}`);
    expect(appointment.status).toBe(200);
    expect(appointment.body.client.name).toBe('Cliente removida');
    expect(appointment.body.status).toBe('CANCELED');
  });

  it('dono com estabelecimento ativo precisa suspender antes de excluir', async () => {
    const fx = await businessFixture();
    const res = await fx.owner.http.delete('/me');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('BUSINESS_ACTIVE');
  });
});
