import { businessFixture, clientSession, workday, prisma, spInstant } from './helpers';

afterAll(() => prisma.$disconnect());

/**
 * SC-002 / Princípio VIII: o dono A nunca lê nem altera recursos do dono B.
 * Todo ID alheio responde 404 (não 403), sem revelar existência.
 */
describe('Isolamento entre estabelecimentos', () => {
  it('todas as rotas /owner com IDs de outro estabelecimento respondem 404', async () => {
    const a = await businessFixture();
    const b = await businessFixture();
    const client = await clientSession();
    const booked = await client.http.post('/appointments', {
      businessId: b.business.id,
      serviceId: b.serviceId,
      startsAt: spInstant(workday(1), '11:00'),
      clientName: 'Cliente de B',
      whatsappConsent: true,
    });
    const block = await b.owner.http.post('/owner/blocks', {
      professionalId: b.professionalIds[0],
      date: workday(2),
      duration: 'day',
      reason: 'DAY_OFF',
    });
    const appointmentId = booked.body.id as string;
    const otherService = b.serviceId;
    const otherProfessional = b.professionalIds[0];

    const attempts = [
      a.owner.http.patch(`/owner/services/${otherService}`, { priceCents: 1 }),
      a.owner.http.delete(`/owner/services/${otherService}`),
      a.owner.http.patch(`/owner/professionals/${otherProfessional}`, { name: 'Invasora' }),
      a.owner.http.post('/owner/professionals', {
        name: 'Xavier',
        serviceIds: [otherService],
        active: false,
      }),
      a.owner.http.get(`/owner/appointments/${appointmentId}`),
      a.owner.http.post(`/owner/appointments/${appointmentId}/cancel`),
      a.owner.http.post(`/owner/appointments/${appointmentId}/confirm`),
      a.owner.http.delete(`/owner/blocks/${block.body.block.id}`),
      a.owner.http.post('/owner/blocks', {
        professionalId: otherProfessional,
        date: workday(3),
        duration: 'day',
        reason: 'DAY_OFF',
      }),
      a.owner.http.post('/owner/appointments', {
        clientName: 'Xuxa',
        clientPhone: '+5562988887777',
        serviceId: otherService,
        professionalId: otherProfessional,
        startsAt: spInstant(workday(4), '09:00'),
      }),
      a.owner.http.get(`/owner/availability?serviceId=${otherService}&date=${workday(1)}`),
    ];
    const results = await Promise.all(attempts);
    expect(results.map((r) => r.status)).toEqual(results.map(() => 404));

    // Nada mudou em B.
    const service = await prisma.service.findUniqueOrThrow({ where: { id: otherService } });
    expect(service.priceCents).toBe(5000);
    const appointment = await prisma.appointment.findUniqueOrThrow({
      where: { id: appointmentId },
    });
    expect(appointment.status).toBe('CONFIRMED');
    expect(await prisma.timeBlock.count({ where: { id: block.body.block.id } })).toBe(1);

    // Listagens de A não trazem nada de B.
    const agenda = await a.owner.http.get(`/owner/agenda?from=${workday(1)}&to=${workday(1)}`);
    expect(agenda.body.appointments).toHaveLength(0);
    const clients = await a.owner.http.get('/owner/clients');
    expect(clients.body.total).toBe(0);
  });

  it('cliente não acessa agendamento de outra cliente', async () => {
    const fx = await businessFixture();
    const owner = await clientSession();
    const intruder = await clientSession();
    const booked = await owner.http.post('/appointments', {
      businessId: fx.business.id,
      serviceId: fx.serviceId,
      startsAt: spInstant(workday(1), '13:00'),
      clientName: 'Dona',
      whatsappConsent: true,
    });
    const id = booked.body.id as string;
    const results = await Promise.all([
      intruder.http.get(`/me/appointments/${id}`),
      intruder.http.post(`/me/appointments/${id}/cancel`),
      intruder.http.patch(`/me/appointments/${id}/reschedule`, {
        startsAt: spInstant(workday(1), '14:00'),
      }),
    ]);
    expect(results.map((r) => r.status)).toEqual([404, 404, 404]);
  });
});
