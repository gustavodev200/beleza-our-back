import { Body, Controller, Delete, Get, HttpCode, Injectable, Module, Patch } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { publicEmail } from '../admin/admin-platform';
import { AllowsMfaEnrollment, CurrentUser, type AuthUser } from '../auth/decorators';
import { Errors } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';

const updateMeSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    whatsappConsent: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Nada para atualizar');
class UpdateMeDto extends createZodDto(updateMeSchema) {}

@Injectable()
export class MeService {
  constructor(private readonly prisma: PrismaService) {}

  async profile(userId: string) {
    const u = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        emailVerified: true,
        phoneNumber: true,
        phoneNumberVerified: true,
        role: true,
        twoFactorEnabled: true,
        whatsappConsentAt: true,
        createdAt: true,
        business: { select: { id: true, name: true, slug: true, status: true } },
      },
    });
    return { ...u, email: publicEmail(u.email), whatsappConsent: Boolean(u.whatsappConsentAt) };
  }

  async update(userId: string, dto: UpdateMeDto) {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        name: dto.name,
        ...(dto.whatsappConsent === undefined
          ? {}
          : { whatsappConsentAt: dto.whatsappConsent ? new Date() : null }),
      },
    });
    return this.profile(userId);
  }

  /** Exportação dos dados pessoais (LGPD, FR-071). Nunca inclui hash, token ou segredo. */
  async exportData(userId: string) {
    const [profile, appointments, reviews, favorites, notifications, business] = await Promise.all([
      this.profile(userId),
      this.prisma.appointment.findMany({
        where: { clientId: userId },
        select: {
          id: true,
          status: true,
          origin: true,
          startsAt: true,
          endsAt: true,
          serviceName: true,
          priceCents: true,
          notes: true,
          createdAt: true,
          business: { select: { name: true, slug: true } },
          professional: { select: { name: true } },
        },
        orderBy: { startsAt: 'desc' },
      }),
      this.prisma.review.findMany({
        where: { clientId: userId },
        select: {
          id: true,
          rating: true,
          tags: true,
          comment: true,
          createdAt: true,
          business: { select: { name: true } },
        },
      }),
      this.prisma.favorite.findMany({
        where: { clientId: userId },
        select: { createdAt: true, business: { select: { name: true, slug: true } } },
      }),
      this.prisma.notification.findMany({
        where: { userId },
        select: { type: true, title: true, body: true, readAt: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.business.findUnique({
        where: { ownerId: userId },
        select: {
          name: true,
          slug: true,
          type: true,
          whatsapp: true,
          phone: true,
          neighborhood: true,
          address: true,
          description: true,
          status: true,
          createdAt: true,
        },
      }),
    ]);
    return {
      exportedAt: new Date(),
      profile,
      business,
      appointments,
      reviews,
      favorites,
      notifications,
    };
  }

  /**
   * Exclusão (FR-072): anonimiza dados pessoais e encerra o acesso; agendamentos
   * ficam para o estabelecimento como "Cliente removida". Dono com
   * estabelecimento ativo ou em análise precisa pedir a suspensão antes.
   */
  async deleteAccount(user: AuthUser): Promise<void> {
    if (user.role === 'SUPER_ADMIN')
      throw Errors.forbidden(
        'ADMIN_DELETE_FORBIDDEN',
        'Contas de admin são removidas pelo suporte interno',
      );
    const business = await this.prisma.business.findUnique({
      where: { ownerId: user.id },
      select: { status: true },
    });
    if (business && (business.status === 'ACTIVE' || business.status === 'PENDING')) {
      throw Errors.conflict(
        'BUSINESS_ACTIVE',
        'Peça a suspensão do estabelecimento antes de excluir a conta',
      );
    }
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.appointment.updateMany({
        where: {
          clientId: user.id,
          status: { in: ['PENDING', 'CONFIRMED'] },
          startsAt: { gt: now },
        },
        data: { status: 'CANCELED', cancelledBy: 'CLIENT' },
      }),
      this.prisma.session.deleteMany({ where: { userId: user.id } }),
      this.prisma.account.deleteMany({ where: { userId: user.id } }),
      this.prisma.twoFactor.deleteMany({ where: { userId: user.id } }),
      this.prisma.favorite.deleteMany({ where: { clientId: user.id } }),
      this.prisma.notification.deleteMany({ where: { userId: user.id } }),
      this.prisma.user.update({
        where: { id: user.id },
        data: {
          name: user.role === 'CLIENT' ? 'Cliente removida' : 'Usuário removido',
          email: `removed-${user.id}@removed.belezaour.local`,
          emailVerified: false,
          phoneNumber: null,
          phoneNumberVerified: false,
          image: null,
          whatsappConsentAt: null,
          twoFactorEnabled: false,
          anonymizedAt: now,
        },
      }),
    ]);
  }
}

@ApiTags('Conta')
@Controller('me')
export class MeController {
  constructor(private readonly me: MeService) {}

  @Get()
  @AllowsMfaEnrollment()
  profile(@CurrentUser() user: AuthUser) {
    return this.me.profile(user.id);
  }

  @Patch()
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateMeDto) {
    return this.me.update(user.id, dto);
  }

  @Get('export')
  exportData(@CurrentUser() user: AuthUser) {
    return this.me.exportData(user.id);
  }

  @Delete()
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser) {
    return this.me.deleteAccount(user);
  }
}

@Module({ controllers: [MeController], providers: [MeService] })
export class MeModule {}
