import {
  HttpClient,
  adminSession,
  businessFixture,
  lastEmailTo,
  ownerSession,
  prisma,
} from './helpers';

afterAll(() => prisma.$disconnect());

async function pendingBusiness() {
  const fx = await businessFixture({ activate: false });
  const res = await fx.owner.http.post('/owner/business/submit');
  expect(res.status).toBe(200);
  return fx;
}

describe('Moderação pelo admin (US3)', () => {
  it('admin sem 2FA só recebe MFA_ENROLLMENT_REQUIRED', async () => {
    const owner = await ownerSession();
    await prisma.user.update({ where: { id: owner.userId }, data: { role: 'SUPER_ADMIN' } });
    const res = await owner.http.get('/admin/businesses');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('MFA_ENROLLMENT_REQUIRED');
  });

  it('sessão de admin com mais de 8h é recusada', async () => {
    const admin = await adminSession();
    const user = await prisma.user.findFirstOrThrow({
      where: { role: 'SUPER_ADMIN', twoFactorEnabled: true },
    });
    await prisma.session.updateMany({
      where: { userId: user.id },
      data: { createdAt: new Date(Date.now() - 9 * 3_600_000) },
    });
    const res = await admin.http.get('/admin/businesses');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('ADMIN_SESSION_EXPIRED');
  });

  it('aprova cadastro pendente: ACTIVE, auditoria e dono notificado', async () => {
    const { business, owner } = await pendingBusiness();
    const { http } = await adminSession();

    const queue = await http.get('/admin/businesses?status=PENDING&pageSize=50');
    expect(queue.status).toBe(200);
    expect(queue.body.items.some((b: { id: string }) => b.id === business.id)).toBe(true);

    const approved = await http.post(`/admin/businesses/${business.id}/approve`);
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe('ACTIVE');

    const audit = await prisma.auditLog.findFirst({
      where: { targetId: business.id, action: 'BUSINESS_APPROVED' },
    });
    expect(audit).not.toBeNull();
    await lastEmailTo(owner.email, 'Seu perfil está no marketplace');
    const notification = await prisma.notification.findFirst({
      where: { userId: owner.userId, type: 'BUSINESS_APPROVED' },
    });
    expect(notification).not.toBeNull();

    const twice = await http.post(`/admin/businesses/${business.id}/approve`);
    expect(twice.status).toBe(422);
  });

  it('recusa exige motivo; dono reenvia e volta a PENDING', async () => {
    const { business, owner } = await pendingBusiness();
    const { http } = await adminSession();

    expect((await http.post(`/admin/businesses/${business.id}/reject`, {})).status).toBe(400);
    const rejected = await http.post(`/admin/businesses/${business.id}/reject`, {
      reason: 'Foto de capa ilegível',
    });
    expect(rejected.body.status).toBe('REJECTED');

    const own = await owner.http.get('/owner/business');
    expect(own.body.rejectionReason).toBe('Foto de capa ilegível');
    const resubmit = await owner.http.post('/owner/business/submit');
    expect(resubmit.body.status).toBe('PENDING');
    expect(resubmit.body.rejectionReason).toBeNull();
  });

  it('suspende e reativa; suspenso não pode ser editado nem destacado', async () => {
    const { business, owner } = await businessFixture();
    const { http } = await adminSession();

    expect(
      (await http.patch(`/admin/businesses/${business.id}/featured`, { featured: true })).body
        .featured,
    ).toBe(true);
    const suspended = await http.post(`/admin/businesses/${business.id}/suspend`);
    expect(suspended.body.status).toBe('SUSPENDED');
    expect(suspended.body.featured).toBe(false);
    expect((await owner.http.patch('/owner/business', { description: 'nova' })).status).toBe(403);
    expect(
      (await http.patch(`/admin/businesses/${business.id}/featured`, { featured: true })).status,
    ).toBe(422);

    const reactivated = await http.post(`/admin/businesses/${business.id}/reactivate`);
    expect(reactivated.body.status).toBe('ACTIVE');
  });

  it('dono, cliente e anônimo não acessam rotas de admin', async () => {
    const { owner } = await businessFixture({ activate: false });
    expect((await owner.http.get('/admin/businesses')).status).toBe(403);
    expect((await new HttpClient().get('/admin/businesses')).status).toBe(401);
  });
});
