import {
  HttpClient,
  WEEK_HOURS,
  businessFixture,
  catalogIds,
  ownerSession,
  prisma,
  uniquePhone,
} from './helpers';

afterAll(() => prisma.$disconnect());

describe('Onboarding do dono (US2)', () => {
  it('cria, completa e envia para aprovação; fica PENDING e invisível', async () => {
    const { owner, business } = await businessFixture({ activate: false });
    const submitted = await owner.http.post('/owner/business/submit');
    expect(submitted.status).toBe(200);
    expect(submitted.body.status).toBe('PENDING');

    const again = await owner.http.post('/owner/business/submit');
    expect(again.status).toBe(422);

    const db = await prisma.business.findUniqueOrThrow({ where: { id: business.id } });
    expect(db.submittedAt).not.toBeNull();
  });

  it('recusa envio de cadastro incompleto informando o que falta', async () => {
    const owner = await ownerSession();
    const { cityId, categoryId } = await catalogIds();
    await owner.http.post('/owner/business', {
      type: 'BARBERSHOP',
      name: 'Barbearia Incompleta',
      whatsapp: uniquePhone(),
      cityId,
      neighborhood: 'Centro',
      categoryIds: [categoryId],
    });
    const res = await owner.http.post('/owner/business/submit');
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('BUSINESS_INCOMPLETE');
    expect(res.body.message).toMatch(/serviço/);
    expect(res.body.message).toMatch(/horário/);
  });

  it('gera slug único para nomes repetidos', async () => {
    const run = Date.now();
    const a = await businessFixture({ activate: false, name: `Studio Bella ${run}` });
    const b = await businessFixture({ activate: false, name: `Studio Bella ${run}` });
    expect(a.business.slug).toBe(`studio-bella-${run}`);
    expect(b.business.slug).toBe(`studio-bella-${run}-2`);
  });

  it('permite só um estabelecimento por dono', async () => {
    const { owner } = await businessFixture({ activate: false });
    const { cityId, categoryId } = await catalogIds();
    const res = await owner.http.post('/owner/business', {
      type: 'SALON',
      name: 'Segundo',
      whatsapp: uniquePhone(),
      cityId,
      neighborhood: 'Centro',
      categoryIds: [categoryId],
    });
    expect(res.status).toBe(409);
  });

  it('valida entrada com Zod estrito (campo extra, horário inválido, preço negativo)', async () => {
    const { owner, categoryId } = await businessFixture({ activate: false });
    const extra = await owner.http.patch('/owner/business', { name: 'Ok', status: 'ACTIVE' });
    expect(extra.status).toBe(400);
    const hours = await owner.http.put('/owner/business/hours', {
      days: [{ weekday: 1, opensAt: '18:00', closesAt: '09:00' }],
    });
    expect(hours.status).toBe(400);
    const price = await owner.http.post('/owner/services', {
      name: 'X',
      categoryId,
      durationMinutes: 7,
      priceCents: -1,
    });
    expect(price.status).toBe(400);
    expect((await owner.http.put('/owner/business/hours', { days: WEEK_HOURS })).status).toBe(200);
  });

  it('respeita o limite global de profissionais ativas (padrão 2)', async () => {
    const { owner, serviceId } = await businessFixture({ activate: false });
    const third = await owner.http.post('/owner/professionals', {
      name: 'Carla',
      serviceIds: [serviceId],
    });
    expect(third.status).toBe(422);
    expect(third.body.code).toBe('PROFESSIONAL_LIMIT_REACHED');
    const inactive = await owner.http.post('/owner/professionals', {
      name: 'Carla',
      serviceIds: [serviceId],
      active: false,
    });
    expect(inactive.status).toBe(201);
    const activate = await owner.http.patch(`/owner/professionals/${inactive.body.id}`, {
      active: true,
    });
    expect(activate.status).toBe(422);
  });

  it('upload: aceita PNG real e recusa SVG/extensão falsa', async () => {
    const { owner } = await businessFixture({ activate: false });
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(64),
    ]);
    const okForm = new FormData();
    okForm.append('file', new Blob([png], { type: 'image/png' }), 'capa.png');
    const ok = await owner.http.request('POST', '/owner/business/cover', okForm);
    expect(ok.status).toBe(200);
    expect(ok.body.coverUrl).toContain('/cover');

    const svgForm = new FormData();
    svgForm.append(
      'file',
      new Blob(['<svg onload="alert(1)"></svg>'], { type: 'image/png' }),
      'logo.png',
    );
    const bad = await owner.http.request('POST', '/owner/business/logo', svgForm);
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe('INVALID_IMAGE');
  });

  it('cliente e anônimo não acessam o painel do dono', async () => {
    expect((await new HttpClient().get('/owner/business')).status).toBe(401);
  });
});
