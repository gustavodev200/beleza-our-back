import { HttpClient, adminSession, businessFixture, clientSession, prisma } from './helpers';

afterAll(() => prisma.$disconnect());

describe('Descoberta (US6)', () => {
  it('busca só ativos de cidade ativa, ignorando acentos', async () => {
    const tag = `Zz${Date.now()}`;
    const active = await businessFixture({ name: `Estética ${tag} Ativa` });
    const pending = await businessFixture({ activate: false, name: `Estética ${tag} Pendente` });
    const suspended = await businessFixture({ name: `Estética ${tag} Suspensa` });
    await prisma.business.update({
      where: { id: suspended.business.id },
      data: { status: 'SUSPENDED' },
    });

    const res = await new HttpClient().get(
      `/businesses?q=${encodeURIComponent(`estetica ${tag.toLowerCase()}`)}`,
    );
    expect(res.status).toBe(200);
    const ids = res.body.items.map((b: { id: string }) => b.id);
    expect(ids).toEqual([active.business.id]);
    expect(ids).not.toContain(pending.business.id);
    expect(res.body.items[0].minPriceCents).toBe(5000);
    expect(res.body.items[0].nextSlots.length).toBeGreaterThan(0);
  });

  it('busca por nome de serviço e por bairro', async () => {
    const tag = `Yy${Date.now()}`;
    const fx = await businessFixture({ name: `Salão ${tag}` });
    await fx.owner.http.post('/owner/services', {
      name: `Design de Sobrancelhas ${tag}`,
      categoryId: fx.categoryId,
      durationMinutes: 30,
      priceCents: 3000,
    });
    const byService = await new HttpClient().get(`/businesses?q=sobrancelhas%20${tag}`);
    expect(byService.body.items.map((b: { id: string }) => b.id)).toContain(fx.business.id);
    const byNeighborhood = await new HttpClient().get(`/businesses?q=setor%20bueno%20${tag}`);
    expect(byNeighborhood.body.items).toHaveLength(1);
  });

  it('serviço novo já nasce com as profissionais ativas e aparece para a cliente', async () => {
    const fx = await businessFixture();
    const created = await fx.owner.http.post('/owner/services', {
      name: 'Hidratação',
      categoryId: fx.categoryId,
      durationMinutes: 45,
      priceCents: 7000,
    });
    expect(created.status).toBe(201);
    expect(created.body.professionals).toHaveLength(2);
    const profile = await new HttpClient().get(`/businesses/${fx.business.slug}`);
    expect(profile.body.services.map((s: { name: string }) => s.name)).toContain('Hidratação');

    const onlyAna = await fx.owner.http.patch(`/owner/services/${created.body.id}`, {
      professionalIds: [fx.professionalIds[0]],
    });
    expect(onlyAna.body.professionals).toEqual([{ professionalId: fx.professionalIds[0] }]);
  });

  it('filtra por slug da cidade; cidade sem cadastro volta vazia', async () => {
    const tag = `Ww${Date.now()}`;
    const fx = await businessFixture({ name: `Salão ${tag}` });
    const { city } = await prisma.business.findUniqueOrThrow({
      where: { id: fx.business.id },
      select: { city: { select: { slug: true } } },
    });
    const inCity = await new HttpClient().get(`/businesses?q=${tag}&citySlug=${city.slug}`);
    expect(inCity.body.items.map((b: { id: string }) => b.id)).toEqual([fx.business.id]);
    const elsewhere = await new HttpClient().get(`/businesses?q=${tag}&citySlug=goianesia-go`);
    expect(elsewhere.status).toBe(200);
    expect(elsewhere.body.total).toBe(0);
    const featured = await new HttpClient().get('/businesses/featured?citySlug=goianesia-go');
    expect(featured.body).toEqual([]);
    expect((await new HttpClient().get('/businesses?citySlug=Nao%20Valido')).status).toBe(400);
  });

  it('perfil público por slug; inativo ou inexistente responde indisponível', async () => {
    const fx = await businessFixture();
    const profile = await new HttpClient().get(`/businesses/${fx.business.slug}`);
    expect(profile.status).toBe(200);
    expect(profile.body.services).toHaveLength(1);
    expect(profile.body.professionals).toHaveLength(2);
    expect(profile.body.nextSlot).not.toBeNull();
    expect(profile.body).not.toHaveProperty('searchText');
    expect(profile.body).not.toHaveProperty('ownerId');

    const pending = await businessFixture({ activate: false });
    expect((await new HttpClient().get(`/businesses/${pending.business.slug}`)).status).toBe(404);
    expect((await new HttpClient().get('/businesses/nao-existe-mesmo')).status).toBe(404);
  });

  it('ordenação por distância exige localização', async () => {
    expect((await new HttpClient().get('/businesses?sort=distance')).status).toBe(422);
    const ok = await new HttpClient().get('/businesses?sort=distance&lat=-16.7&lng=-49.27');
    expect(ok.status).toBe(200);
  });

  it('destaques definidos pelo admin trazem até 3 horários', async () => {
    const fx = await businessFixture();
    const { http } = await adminSession();
    await http.patch(`/admin/businesses/${fx.business.id}/featured`, { featured: true });
    const featured = await new HttpClient().get('/businesses/featured');
    const card = featured.body.find((b: { id: string }) => b.id === fx.business.id);
    expect(card).toBeDefined();
    expect(card.nextSlots.length).toBeLessThanOrEqual(3);
    await http.patch(`/admin/businesses/${fx.business.id}/featured`, { featured: false });
  });

  it('favoritos são idempotentes e só aceitam estabelecimento ativo', async () => {
    const fx = await businessFixture();
    const client = await clientSession();
    expect((await client.http.put(`/me/favorites/${fx.business.id}`)).status).toBe(204);
    expect((await client.http.put(`/me/favorites/${fx.business.id}`)).status).toBe(204);
    const list = await client.http.get('/me/favorites');
    expect(list.body.filter((f: { id: string }) => f.id === fx.business.id)).toHaveLength(1);
    expect((await client.http.delete(`/me/favorites/${fx.business.id}`)).status).toBe(204);
    expect((await client.http.get('/me/favorites')).body).toHaveLength(0);

    const pending = await businessFixture({ activate: false });
    expect((await client.http.put(`/me/favorites/${pending.business.id}`)).status).toBe(404);
  });

  it('categorias ocultas somem do catálogo público', async () => {
    const { http } = await adminSession();
    const created = await http.post('/admin/categories', {
      name: `Cat ${Date.now()}`,
      icon: 'spa',
      visible: false,
    });
    expect(created.status).toBe(201);
    const publicList = await new HttpClient().get('/categories');
    expect(publicList.body.map((c: { id: string }) => c.id)).not.toContain(created.body.id);
  });
});
