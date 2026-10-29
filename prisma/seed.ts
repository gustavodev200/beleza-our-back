import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from 'better-auth/crypto';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const CATEGORIES = [
  { name: 'Unhas', slug: 'unhas', icon: 'back_hand' },
  { name: 'Sobrancelhas', slug: 'sobrancelhas', icon: 'visibility' },
  { name: 'Cabelo', slug: 'cabelo', icon: 'content_cut' },
  { name: 'Barbearia', slug: 'barbearia', icon: 'face' },
  { name: 'Estética', slug: 'estetica', icon: 'spa' },
  { name: 'Maquiagem', slug: 'maquiagem', icon: 'brush' },
  { name: 'Depilação', slug: 'depilacao', icon: 'self_care' },
];

async function seedCatalog(): Promise<void> {
  await prisma.city.upsert({
    where: { slug: 'goiania-go' },
    create: { name: 'Goiânia', state: 'GO', slug: 'goiania-go', active: true },
    update: {},
  });
  for (const [index, category] of CATEGORIES.entries()) {
    await prisma.category.upsert({
      where: { slug: category.slug },
      create: { ...category, sortOrder: index },
      update: {},
    });
  }
  await prisma.platformSetting.upsert({
    where: { id: 'global' },
    create: { id: 'global' },
    update: {},
  });
}

/** Admin só nasce aqui (FR-005). Precisa ativar o 2FA no primeiro acesso. */
async function seedAdmin(): Promise<void> {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? '';
  if (!email) {
    console.log('ADMIN_EMAIL vazio — admin não criado.');
    return;
  }
  if (password.length < 12) throw new Error('ADMIN_PASSWORD precisa de ao menos 12 caracteres');

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log('Admin já existe — mantido sem alteração.');
    return;
  }
  const id = randomBytes(16).toString('hex');
  await prisma.user.create({
    data: {
      id,
      name: 'Administrador',
      email,
      emailVerified: true,
      role: 'SUPER_ADMIN',
      accounts: {
        create: {
          id: randomBytes(16).toString('hex'),
          accountId: id,
          providerId: 'credential',
          password: await hashPassword(password),
        },
      },
    },
  });
  console.log('Admin criado.');
}

async function main(): Promise<void> {
  await seedCatalog();
  await seedAdmin();
  console.log('Seed concluído.');
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
