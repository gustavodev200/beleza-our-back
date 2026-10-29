import { Injectable, Logger } from '@nestjs/common';
import { TZDate } from '@date-fns/tz';
import { format } from 'date-fns';
import type { AppointmentStatus, Prisma } from '@prisma/client';
import { loadEnv } from '../config/env';
import { TIMEZONE } from '../common/utils/time';
import { emailLayout, escapeHtml, EmailService } from '../integrations/email/email.service';
import { WhatsappService } from '../integrations/whatsapp/whatsapp.service';
import { PrismaService } from '../prisma/prisma.service';

const appointmentInclude = {
  business: { select: { id: true, name: true, ownerId: true, address: true, neighborhood: true } },
  client: { select: { id: true, name: true, phoneNumber: true, whatsappConsentAt: true } },
  professional: { select: { name: true } },
} satisfies Prisma.AppointmentInclude;

type AppointmentWithParties = Prisma.AppointmentGetPayload<{ include: typeof appointmentInclude }>;

export function formatWhen(instant: Date): string {
  return format(new TZDate(instant, TIMEZONE), "dd/MM 'às' HH:mm");
}

const STATUS_TEXT: Partial<Record<AppointmentStatus, { title: string; verb: string }>> = {
  CONFIRMED: { title: 'Agendamento confirmado', verb: 'foi confirmado' },
  COMPLETED: { title: 'Atendimento concluído', verb: 'foi concluído' },
  CANCELED: { title: 'Agendamento cancelado', verb: 'foi cancelado pelo estabelecimento' },
  NO_SHOW: { title: 'Ausência registrada', verb: 'foi marcado como não comparecimento' },
};

/**
 * Notificações in-app + WhatsApp + e-mail. Sempre chamado **depois** do commit
 * e nunca lança: falha aqui não desfaz nem repete a operação (Princípio XI).
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly frontendUrl = loadEnv().FRONTEND_URL;

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsappService,
    private readonly email: EmailService,
  ) {}

  async appointmentCreated(appointmentId: string): Promise<void> {
    await this.safely('appointmentCreated', async () => {
      const a = await this.load(appointmentId);
      const when = formatWhen(a.startsAt);
      const pending = a.status === 'PENDING';
      await this.inApp(a.clientId, {
        type: pending ? 'APPOINTMENT_REQUESTED' : 'APPOINTMENT_CONFIRMED',
        title: pending ? 'Agendamento solicitado' : 'Horário confirmado!',
        body: `${a.serviceName} em ${a.business.name}, ${when} com ${a.professional.name}.`,
        data: { appointmentId: a.id },
      });
      await this.whatsappToClient(
        a,
        pending
          ? `belezaOur: recebemos seu pedido de ${a.serviceName} em ${a.business.name} para ${when}. Aguarde a confirmação do estabelecimento.`
          : `belezaOur: horário confirmado! ${a.serviceName} em ${a.business.name}, ${when} com ${a.professional.name}. Pagamento no local.`,
      );
      if (a.origin === 'APP') {
        await this.inApp(a.business.ownerId, {
          type: 'NEW_APPOINTMENT',
          title: pending ? 'Novo agendamento aguardando confirmação' : 'Novo agendamento',
          body: `${a.client.name} · ${a.serviceName} · ${when} · ${a.professional.name}`,
          data: { appointmentId: a.id },
        });
      }
    });
  }

  async appointmentStatusByOwner(appointmentId: string, status: AppointmentStatus): Promise<void> {
    const text = STATUS_TEXT[status];
    if (!text) return;
    await this.safely('appointmentStatusByOwner', async () => {
      const a = await this.load(appointmentId);
      const message = `Seu agendamento de ${a.serviceName} em ${a.business.name} (${formatWhen(a.startsAt)}) ${text.verb}.`;
      await this.inApp(a.clientId, {
        type: `APPOINTMENT_${status}`,
        title: text.title,
        body: message,
        data: { appointmentId: a.id },
      });
      await this.whatsappToClient(a, `belezaOur: ${message}`);
    });
  }

  async appointmentChangedByClient(
    appointmentId: string,
    change: 'CANCELED' | 'RESCHEDULED',
  ): Promise<void> {
    await this.safely('appointmentChangedByClient', async () => {
      const a = await this.load(appointmentId);
      await this.inApp(a.business.ownerId, {
        type: change === 'CANCELED' ? 'CLIENT_CANCELED' : 'CLIENT_RESCHEDULED',
        title: change === 'CANCELED' ? 'Cliente cancelou' : 'Cliente remarcou',
        body: `${a.client.name} · ${a.serviceName} · ${formatWhen(a.startsAt)} · ${a.professional.name}`,
        data: { appointmentId: a.id },
      });
    });
  }

  async reminder(appointmentId: string, hoursBefore: 24 | 2): Promise<void> {
    await this.safely('reminder', async () => {
      const a = await this.load(appointmentId);
      await this.whatsappToClient(
        a,
        `belezaOur: lembrete — ${a.serviceName} em ${a.business.name} ${hoursBefore === 24 ? 'amanhã' : 'daqui a 2 horas'}, ${formatWhen(a.startsAt)}.`,
      );
    });
  }

  async reviewInvite(appointmentId: string): Promise<void> {
    await this.safely('reviewInvite', async () => {
      const a = await this.load(appointmentId);
      const body = `Como foi seu atendimento em ${a.business.name}? Sua avaliação ajuda outras clientes.`;
      await this.inApp(a.clientId, {
        type: 'REVIEW_INVITE',
        title: 'Avalie seu atendimento',
        body,
        data: { appointmentId: a.id },
      });
      await this.whatsappToClient(a, `belezaOur: ${body} ${this.frontendUrl}/appointments`);
    });
  }

  async businessDecision(businessId: string, approved: boolean, reason?: string): Promise<void> {
    await this.safely('businessDecision', async () => {
      const b = await this.prisma.business.findUniqueOrThrow({
        where: { id: businessId },
        select: {
          name: true,
          slug: true,
          whatsapp: true,
          owner: { select: { id: true, name: true, email: true } },
        },
      });
      const title = approved
        ? 'Seu perfil está no marketplace!'
        : 'Ajustes necessários no cadastro';
      const body = approved
        ? `${b.name} foi aprovado e já aparece para as clientes.`
        : `Seu cadastro precisa de ajustes: ${reason ?? ''}`;
      await this.inApp(b.owner.id, {
        type: approved ? 'BUSINESS_APPROVED' : 'BUSINESS_REJECTED',
        title,
        body,
        data: { businessId },
      });
      await this.email.send({
        to: b.owner.email,
        subject: `${title} — belezaOur`,
        html: emailLayout(
          title,
          [`Olá, ${escapeHtml(b.owner.name)}.`, escapeHtml(body)],
          approved
            ? { label: 'Ver meu perfil público', url: `${this.frontendUrl}/${b.slug}` }
            : { label: 'Revisar cadastro', url: `${this.frontendUrl}/dashboard` },
        ),
      });
      await this.whatsapp.send({ to: b.whatsapp, text: `belezaOur: ${body}` });
    });
  }

  async businessSuspended(businessId: string): Promise<void> {
    await this.safely('businessSuspended', async () => {
      const b = await this.prisma.business.findUniqueOrThrow({
        where: { id: businessId },
        select: { ownerId: true, name: true },
      });
      await this.inApp(b.ownerId, {
        type: 'BUSINESS_SUSPENDED',
        title: 'Estabelecimento suspenso',
        body: `${b.name} foi suspenso e não aparece no marketplace. Fale com o suporte.`,
        data: { businessId },
      });
    });
  }

  private load(appointmentId: string): Promise<AppointmentWithParties> {
    return this.prisma.appointment.findUniqueOrThrow({
      where: { id: appointmentId },
      include: appointmentInclude,
    });
  }

  private async inApp(
    userId: string,
    n: { type: string; title: string; body: string; data?: Prisma.InputJsonValue },
  ): Promise<void> {
    await this.prisma.notification.create({ data: { userId, ...n } });
  }

  /** WhatsApp para a cliente só com consentimento registrado (LGPD, FR-070). */
  private async whatsappToClient(a: AppointmentWithParties, text: string): Promise<void> {
    if (!a.client.phoneNumber || !a.client.whatsappConsentAt) return;
    await this.whatsapp.send({ to: a.client.phoneNumber, text });
  }

  private async safely(event: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (e) {
      this.logger.error(
        `Falha ao notificar (${event}): ${e instanceof Error ? e.message : 'erro'}`,
      );
    }
  }
}
