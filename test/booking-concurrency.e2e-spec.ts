import { businessFixture, clientSession, workday, prisma, spInstant } from './helpers';

afterAll(() => prisma.$disconnect());

describe('Concorrência de reservas (SC-001)', () => {
  it('50 reservas simultâneas no mesmo horário e profissional geram exatamente 1', async () => {
    const fx = await businessFixture();
    const clients = await Promise.all(Array.from({ length: 5 }, () => clientSession()));
    const startsAt = spInstant(workday(2), '10:00');
    const [ana] = fx.professionalIds;

    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        clients[i % clients.length].http.post('/appointments', {
          businessId: fx.business.id,
          serviceId: fx.serviceId,
          professionalId: ana,
          startsAt,
          clientName: 'Cliente Concorrente',
          whatsappConsent: true,
        }),
      ),
    );
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(49);

    const stored = await prisma.appointment.count({
      where: {
        professionalId: ana,
        startsAt: new Date(startsAt),
        status: { in: ['PENDING', 'CONFIRMED'] },
      },
    });
    expect(stored).toBe(1);
  });

  it('sem preferência concorrente preenche as duas profissionais e para', async () => {
    const fx = await businessFixture();
    const client = await clientSession();
    const startsAt = spInstant(workday(3), '10:00');
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        client.http.post('/appointments', {
          businessId: fx.business.id,
          serviceId: fx.serviceId,
          startsAt,
          clientName: 'Cliente',
          whatsappConsent: true,
        }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    expect(results.filter((r) => r.status === 409)).toHaveLength(18);
  });
});
