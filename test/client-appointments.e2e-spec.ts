import {
  adminSession,
  businessFixture,
  clientSession,
  prisma,
  spInstant,
  workday,
} from './helpers';

afterAll(() => prisma.$disconnect());

type Fixture = Awaited<ReturnType<typeof businessFixture>>;

async function bookAt(
  fx: Fixture,
  client: Awaited<ReturnType<typeof clientSession>>,
  startsAt: string,
  professionalId?: string,
) {
  const res = await client.http.post('/appointments', {
    businessId: fx.business.id,
    serviceId: fx.serviceId,
    professionalId,
    startsAt,
    clientName: 'Lia',
    whatsappConsent: true,
  });
  expect(res.status).toBe(201);
  return res.body as { id: string };
}

describe('Cliente acompanha, remarca, cancela e avalia (US5)', () => {
  it('lista próximos e histórico', async () => {
    const fx = await businessFixture();
    const client = await clientSession();
    const a = await bookAt(fx, client, spInstant(workday(1), '09:00'));
    const upcoming = await client.http.get('/me/appointments?scope=upcoming');
    expect(upcoming.body.items.map((i: { id: string }) => i.id)).toContain(a.id);
    await client.http.post(`/me/appointments/${a.id}/cancel`);
    const history = await client.http.get('/me/appointments?scope=history');
    expect(history.body.items[0].status).toBe('CANCELED');
  });

  it('cancela dentro do prazo e recusa fora dele (prazo global configurável)', async () => {
    const fx = await businessFixture();
    const client = await clientSession();
    const a = await bookAt(fx, client, spInstant(workday(1), '10:00'));
    const ok = await client.http.post(`/me/appointments/${a.id}/cancel`);
    expect(ok.body.status).toBe('CANCELED');
    expect(ok.body.cancelledBy).toBe('CLIENT');
    const owner = await prisma.notification.findFirst({
      where: { userId: fx.owner.userId, type: 'CLIENT_CANCELED' },
    });
    expect(owner).not.toBeNull();

    const b = await bookAt(fx, client, spInstant(workday(1), '11:00'));
    // Começa em 1h → dentro da janela padrão de 2h.
    await prisma.appointment.update({
      where: { id: b.id },
      data: {
        startsAt: new Date(Date.now() + 3_600_000),
        endsAt: new Date(Date.now() + 2 * 3_600_000),
      },
    });
    const late = await client.http.post(`/me/appointments/${b.id}/cancel`);
    expect(late.status).toBe(422);
    expect(late.body.code).toBe('CANCELLATION_WINDOW_CLOSED');
  });

  it('remarca para horário livre mantendo o preço; recusa horário ocupado', async () => {
    const fx = await businessFixture();
    const client = await clientSession();
    const [ana] = fx.professionalIds;
    const a = await bookAt(fx, client, spInstant(workday(2), '09:00'), ana);
    await fx.owner.http.patch(`/owner/services/${fx.serviceId}`, { priceCents: 12000 });

    const moved = await client.http.patch(`/me/appointments/${a.id}/reschedule`, {
      startsAt: spInstant(workday(2), '13:00'),
      professionalId: ana,
    });
    expect(moved.status).toBe(200);
    expect(moved.body.startsAt).toBe(spInstant(workday(2), '13:00'));
    expect(moved.body.priceCents).toBe(5000);

    // Remarcar para o próprio horário atual é permitido (ele não conta como ocupado).
    const same = await client.http.patch(`/me/appointments/${a.id}/reschedule`, {
      startsAt: spInstant(workday(2), '13:00'),
      professionalId: ana,
    });
    expect(same.status).toBe(200);

    const other = await clientSession();
    await bookAt(fx, other, spInstant(workday(2), '15:00'), ana);
    const taken = await client.http.patch(`/me/appointments/${a.id}/reschedule`, {
      startsAt: spInstant(workday(2), '15:00'),
      professionalId: ana,
    });
    expect(taken.body.code).toBe('SLOT_TAKEN');
  });

  it('avalia uma vez atendimento concluído e atualiza a nota do estabelecimento', async () => {
    const fx = await businessFixture();
    const client = await clientSession();
    const a = await bookAt(fx, client, spInstant(workday(3), '09:00'));

    const tooEarly = await client.http.post(`/me/appointments/${a.id}/review`, { rating: 5 });
    expect(tooEarly.body.code).toBe('NOT_COMPLETED');

    await prisma.appointment.update({
      where: { id: a.id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    const review = await client.http.post(`/me/appointments/${a.id}/review`, {
      rating: 4,
      tags: ['PUNCTUAL', 'FAIR_PRICE'],
      comment: 'Muito bom!',
    });
    expect(review.status).toBe(201);
    const again = await client.http.post(`/me/appointments/${a.id}/review`, { rating: 1 });
    expect(again.status).toBe(409);

    const business = await prisma.business.findUniqueOrThrow({ where: { id: fx.business.id } });
    expect(Number(business.ratingAvg)).toBe(4);
    expect(business.ratingCount).toBe(1);

    const invalid = await client.http.post(`/me/appointments/${a.id}/review`, {
      rating: 6,
      tags: ['FAKE'],
    });
    expect(invalid.status).toBe(400);
  });

  it('prazo de cancelamento definido pelo admin vale na hora', async () => {
    const { http } = await adminSession();
    const updated = await http.patch('/admin/settings', { cancellationWindowMinutes: 1440 });
    expect(updated.status).toBe(200);
    try {
      const fx = await businessFixture();
      const client = await clientSession();
      const a = await bookAt(fx, client, spInstant(workday(1), '14:00'));
      // Começa em ~20h: fora da janela de 24h.
      await prisma.appointment.update({
        where: { id: a.id },
        data: {
          startsAt: new Date(Date.now() + 20 * 3_600_000),
          endsAt: new Date(Date.now() + 21 * 3_600_000),
        },
      });
      expect((await client.http.post(`/me/appointments/${a.id}/cancel`)).body.code).toBe(
        'CANCELLATION_WINDOW_CLOSED',
      );
    } finally {
      await http.patch('/admin/settings', { cancellationWindowMinutes: 120 });
    }
  });
});
