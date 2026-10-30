import { Body, Controller, Delete, Get, Headers, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { CurrentUser, Public, type AuthUser } from '../auth/decorators';
import { PushService } from '../integrations/push/push.service';
import { PrismaService } from '../prisma/prisma.service';

const endpointSchema = z
  .string()
  .url()
  .max(2048)
  .refine((v) => v.startsWith('https://'), 'Endpoint inválido');
const subscribeSchema = z
  .object({
    endpoint: endpointSchema,
    keys: z.object({ p256dh: z.string().min(1).max(256), auth: z.string().min(1).max(256) }),
  })
  .strip();
class SubscribeDto extends createZodDto(subscribeSchema) {}
const unsubscribeSchema = z.object({ endpoint: endpointSchema }).strict();
class UnsubscribeDto extends createZodDto(unsubscribeSchema) {}

@ApiTags('Notificações')
@Controller()
export class PushSubscriptionsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
  ) {}

  /** Chave pública VAPID para o navegador assinar; null = push desligado no servidor. */
  @Public()
  @Get('push/public-key')
  publicKey() {
    return { publicKey: this.push.publicKey };
  }

  /** Inscreve o aparelho. Endpoint já usado por outra conta passa para a atual. */
  @Post('me/push-subscriptions')
  @HttpCode(204)
  async subscribe(
    @CurrentUser() user: AuthUser,
    @Body() dto: SubscribeDto,
    @Headers('user-agent') userAgent?: string,
  ): Promise<void> {
    const data = {
      userId: user.id,
      p256dh: dto.keys.p256dh,
      auth: dto.keys.auth,
      userAgent: userAgent?.slice(0, 300) ?? null,
    };
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: dto.endpoint },
      create: { endpoint: dto.endpoint, ...data },
      update: data,
    });
  }

  @Delete('me/push-subscriptions')
  @HttpCode(204)
  async unsubscribe(@CurrentUser() user: AuthUser, @Body() dto: UnsubscribeDto): Promise<void> {
    await this.prisma.pushSubscription.deleteMany({
      where: { endpoint: dto.endpoint, userId: user.id },
    });
  }
}
