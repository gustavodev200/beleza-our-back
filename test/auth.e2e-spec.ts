import {
  HttpClient,
  clientSession,
  lastEmailTo,
  lastOtpFor,
  linkFrom,
  prisma,
  readOutbox,
  signUpOwner,
  uniqueEmail,
  uniqueCpf,
  uniquePhone,
  verifyEmailOf,
} from './helpers';

afterAll(() => prisma.$disconnect());

describe('Auth do dono (e-mail e senha)', () => {
  it('cria conta como BUSINESS_OWNER mesmo se o corpo tentar definir outro papel', async () => {
    const http = new HttpClient();
    const email = uniqueEmail();
    await http.post('/auth/sign-up/email', {
      name: 'Tentativa',
      email,
      password: 'senha-forte-123',
      role: 'SUPER_ADMIN',
      cpfCnpj: uniqueCpf(),
      acceptedTerms: true,
    });
    const user = await prisma.user.findUnique({ where: { email } });
    // Better Auth recusa o campo (input:false) ou ignora; em nenhum caso vira admin.
    if (user) expect(user.role).toBe('BUSINESS_OWNER');
  });

  it('cadastro grava CPF só com dígitos e o aceite dos termos', async () => {
    const http = new HttpClient();
    const email = uniqueEmail();
    const cpf = uniqueCpf();
    const masked = `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
    const res = await http.post('/auth/sign-up/email', {
      name: 'Dona Teste',
      email,
      password: 'senha-forte-123',
      cpfCnpj: masked,
      acceptedTerms: true,
    });
    expect(res.status).toBe(200);
    const user = await prisma.user.findUnique({ where: { email } });
    expect(user?.cpfCnpj).toBe(cpf);
    expect(user?.termsAcceptedAt).toBeInstanceOf(Date);
    expect(user?.termsVersion).toBeTruthy();
  });

  it('recusa cadastro sem aceite, com documento inválido ou repetido', async () => {
    const http = new HttpClient();
    const base = { name: 'Dona Teste', password: 'senha-forte-123' };
    const cpf = uniqueCpf();

    const noTerms = await http.post('/auth/sign-up/email', {
      ...base,
      email: uniqueEmail(),
      cpfCnpj: cpf,
    });
    expect(noTerms.status).toBe(400);

    const badDoc = await http.post('/auth/sign-up/email', {
      ...base,
      email: uniqueEmail(),
      cpfCnpj: '111.111.111-11',
      acceptedTerms: true,
    });
    expect(badDoc.status).toBe(400);

    const first = await http.post('/auth/sign-up/email', {
      ...base,
      email: uniqueEmail(),
      cpfCnpj: cpf,
      acceptedTerms: true,
    });
    expect(first.status).toBe(200);
    const dup = await http.post('/auth/sign-up/email', {
      ...base,
      email: uniqueEmail(),
      cpfCnpj: cpf,
      acceptedTerms: true,
    });
    expect(dup.status).toBe(422);
  });

  it('exige e-mail verificado antes de entrar', async () => {
    const owner = await signUpOwner();
    const denied = await owner.http.post('/auth/sign-in/email', {
      email: owner.email,
      password: owner.password,
    });
    expect(denied.status).toBe(403);

    await verifyEmailOf(owner.email);
    const ok = await owner.http.post('/auth/sign-in/email', {
      email: owner.email,
      password: owner.password,
    });
    expect(ok.status).toBe(200);
    const session = await owner.http.get('/auth/get-session');
    expect(session.body.user.email).toBe(owner.email);
  });

  it('recuperação de senha: resposta idêntica para e-mail inexistente e revoga sessões ao redefinir', async () => {
    const owner = await signUpOwner();
    await verifyEmailOf(owner.email);
    await owner.http.post('/auth/sign-in/email', { email: owner.email, password: owner.password });

    const anon = new HttpClient();
    const unknown = await anon.post('/auth/request-password-reset', {
      email: uniqueEmail('ninguem'),
      redirectTo: 'http://localhost:3000/redefinir-senha',
    });
    const known = await anon.post('/auth/request-password-reset', {
      email: owner.email,
      redirectTo: 'http://localhost:3000/redefinir-senha',
    });
    expect(unknown.status).toBe(200);
    expect(known.status).toBe(200);
    expect(known.body).toEqual(unknown.body);

    const mail = await lastEmailTo(owner.email, 'Redefinição de senha');
    const resetLink = new URL(linkFrom(mail.html!));
    const token = resetLink.pathname.split('/').pop();
    const reset = await anon.post('/auth/reset-password', { token, newPassword: 'nova-senha-456' });
    expect(reset.status).toBe(200);

    const stale = await owner.http.get('/auth/get-session');
    expect(stale.body?.user).toBeUndefined();
  });

  it('bloqueia a conta após 5 senhas erradas, mesmo com a senha certa em seguida', async () => {
    const owner = await signUpOwner();
    await verifyEmailOf(owner.email);
    for (let i = 0; i < 5; i += 1) {
      const res = await owner.http.post('/auth/sign-in/email', {
        email: owner.email,
        password: 'errada-123456',
      });
      expect(res.status).toBe(401);
    }
    const locked = await owner.http.post('/auth/sign-in/email', {
      email: owner.email,
      password: owner.password,
    });
    expect(locked.status).toBe(429);
  });
});

describe('Auth da cliente (código no WhatsApp)', () => {
  it('cria a conta como CLIENT na primeira verificação', async () => {
    const client = await clientSession();
    const user = await prisma.user.findUniqueOrThrow({ where: { id: client.userId } });
    expect(user.role).toBe('CLIENT');
    expect(user.phoneNumberVerified).toBe(true);
  });

  it('recusa celular inválido', async () => {
    const res = await new HttpClient().post('/auth/phone-number/send-otp', {
      phoneNumber: '+5562333300000',
    });
    expect(res.status).toBe(400);
  });

  it('aplica intervalo de 30 s entre envios e máximo de 3 por 10 min', async () => {
    const phone = uniquePhone();
    const http = new HttpClient();
    expect((await http.post('/auth/phone-number/send-otp', { phoneNumber: phone })).status).toBe(
      200,
    );
    expect((await http.post('/auth/phone-number/send-otp', { phoneNumber: phone })).status).toBe(
      429,
    );

    // Simula envios antigos para atingir o teto sem esperar.
    await prisma.otpSendLog.updateMany({
      where: { phoneNumber: phone },
      data: { createdAt: new Date(Date.now() - 60_000) },
    });
    await prisma.otpSendLog.create({
      data: { phoneNumber: phone, createdAt: new Date(Date.now() - 60_000) },
    });
    await prisma.otpSendLog.create({
      data: { phoneNumber: phone, createdAt: new Date(Date.now() - 60_000) },
    });
    expect((await http.post('/auth/phone-number/send-otp', { phoneNumber: phone })).status).toBe(
      429,
    );
  });

  it('teto diário de 8 envios por telefone (força bruta do código de 4 dígitos)', async () => {
    const phone = uniquePhone();
    const oneHourAgo = new Date(Date.now() - 3_600_000);
    await prisma.otpSendLog.createMany({
      data: Array.from({ length: 8 }, () => ({ phoneNumber: phone, createdAt: oneHourAgo })),
    });
    const res = await new HttpClient().post('/auth/phone-number/send-otp', { phoneNumber: phone });
    expect(res.status).toBe(429);
  });

  it('invalida o código após 3 tentativas erradas', async () => {
    const phone = uniquePhone();
    const http = new HttpClient();
    const before = readOutbox().length;
    await http.post('/auth/phone-number/send-otp', { phoneNumber: phone });
    const code = await lastOtpFor(phone, before);
    const wrong = code === '0000' ? '1111' : '0000';
    for (let i = 0; i < 3; i += 1) {
      const res = await http.post('/auth/phone-number/verify', { phoneNumber: phone, code: wrong });
      expect(res.status).toBeGreaterThanOrEqual(400);
    }
    const late = await http.post('/auth/phone-number/verify', { phoneNumber: phone, code });
    expect(late.status).toBeGreaterThanOrEqual(400);
  });
});
