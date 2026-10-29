import {
  HttpClient,
  adminSession,
  businessFixture,
  clientSession,
  prisma,
  spInstant,
  workday,
} from './helpers';

afterAll(() => prisma.$disconnect());

describe('Administração da plataforma (US8)', () => {
  it('bloquear usuário encerra a sessão e impede novo login; desbloquear libera', async () => {
    const { http } = await adminSession();
    const client = await clientSession();
    expect((await client.http.get('/me')).status).toBe(200);

    const blocked = await http.post(`/admin/users/${client.userId}/block`, { reason: 'Spam' });
    expect(blocked.status).toBe(200);
    expect((await client.http.get('/me')).status).toBe(401);

    const again = new HttpClient();
    await again.post('/auth/phone-number/send-otp', { phoneNumber: client.phone });
    const audit = await prisma.auditLog.findFirst({
      where: { targetId: client.userId, action: 'USER_BLOCKED' },
    });
    expect(audit).not.toBeNull();

    expect((await http.post(`/admin/users/${client.userId}/unblock`)).status).toBe(200);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: client.userId } });
    expect(user.banned).toBe(false);
  });

  it('usuário bloqueado não obtém sessão nem com o código correto', async () => {
    const { http } = await adminSession();
    const client = await clientSession();
    await http.post(`/admin/users/${client.userId}/block`, {});
    await prisma.otpSendLog.deleteMany({ where: { phoneNumber: client.phone } });
    await expect(clientSession(client.phone)).rejects.toThrow(/verify falhou: 403/);
    await http.post(`/admin/users/${client.userId}/unblock`);
  });

  it('admin não pode ser bloqueado', async () => {
    const { http } = await adminSession();
    const admin = await prisma.user.findFirstOrThrow({
      where: { role: 'SUPER_ADMIN', twoFactorEnabled: true },
    });
    const res = await http.post(`/admin/users/${admin.id}/block`, {});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CANNOT_BLOCK_ADMIN');
  });

  it('lista usuários com contagem por papel, sem expor e-mail técnico de telefone', async () => {
    const { http } = await adminSession();
    await clientSession();
    const res = await http.get('/admin/users?role=CLIENT&pageSize=5');
    expect(res.status).toBe(200);
    expect(res.body.counts.CLIENT).toBeGreaterThan(0);
    for (const u of res.body.items) expect(u.email).toBeNull();
  });

  it('configurações: aprovação sempre obrigatória e valores fora da lista recusados', async () => {
    const { http } = await adminSession();
    const settings = await http.get('/admin/settings');
    expect(settings.body.approvalRequired).toBe(true);
    expect((await http.patch('/admin/settings', { cancellationWindowMinutes: 45 })).status).toBe(
      400,
    );
    expect((await http.patch('/admin/settings', { approvalRequired: false })).status).toBe(400);
  });

  it('dashboard traz KPIs coerentes e cidades/auditoria respondem', async () => {
    const { http } = await adminSession();
    const fx = await businessFixture();
    const client = await clientSession();
    await client.http.post('/appointments', {
      businessId: fx.business.id,
      serviceId: fx.serviceId,
      startsAt: spInstant(workday(1), '17:00'),
      clientName: 'Fê',
      whatsappConsent: true,
    });
    const to = workday(5);
    const dash = await http.get(`/admin/dashboard?to=${to}`);
    expect(dash.status).toBe(200);
    expect(dash.body.kpis.activeBusinesses).toBeGreaterThan(0);
    expect(dash.body.kpis.appointments).toBeGreaterThan(0);
    expect(dash.body.appointmentsByDay).toHaveLength(7);

    const cities = await http.get('/admin/cities');
    expect(cities.body.some((c: { slug: string }) => c.slug === 'goiania-go')).toBe(true);
    const audit = await http.get('/admin/audit-logs');
    expect(audit.body.total).toBeGreaterThan(0);

    const agenda = await http.get(
      `/admin/businesses/${fx.business.id}/agenda?from=${workday(1)}&to=${workday(1)}`,
    );
    expect(agenda.body.appointments).toHaveLength(1);
  });
});
