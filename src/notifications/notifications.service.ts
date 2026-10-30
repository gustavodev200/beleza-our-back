import { Injectable, Logger } from '@nestjs/common';
import { TZDate } from '@date-fns/tz';
import { format } from 'date-fns';
import type { AppointmentStatus, Prisma } from '@prisma/client';
import { PHONE_EMAIL_DOMAIN } from '../auth/better-auth';
import { loadEnv } from '../config/env';
import { TIMEZONE } from '../common/utils/time';
import { emailLayout, escapeHtml, EmailService } from '../integrations/email/email.service';
import { PushService } from '../integrations/push/push.service';
import { WhatsappService } from '../integrations/whatsapp/whatsapp.service';
import { PrismaService } from '../prisma/prisma.service';

const contact = { id: true, name: true, email: true, emailVerified: true } as const;

const appointmentInclude = {
  business: {
    select: {
      id: true,
      name: true,
      ownerId: true,
      address: true,
      neighborhood: true,
      owner: { select: contact },
    },
  },
  client: { select: { ...contact, phoneNumber: true, whatsappConsentAt: true } },
  professional: { select: { name: true } },
} satisfies Prisma.AppointmentInclude;

type AppointmentWithParties = Prisma.AppointmentGetPayload<{ include: typeof appointmentInclude }>;

export function formatWhen(instant: Date): string {
  return format(new TZDate(instant, TIMEZONE), "dd/MM 'às' HH:mm");
}

function formatTime(instant: Date): string {
  return format(new TZDate(instant, TIMEZONE), 'HH:mm');
}

/** Lembrete curto: 15 min antes (`SOON`) e no horário marcado (`NOW`). */
export type UpcomingStage = 'SOON' | 'NOW';

// Rotas do front abertas ao tocar no push.
const CLIENT_URL = '/appointments';
const OWNER_URL = '/dashboard';
const OWNER_SCHEDULE_URL = '/dashboard/schedule';

const STATUS_TEXT: Partial<Record<AppointmentStatus, { title: string; verb: string }>> = {
  CONFIRMED: { title: 'Agendamento confirmado', verb: 'foi confirmado' },
  COMPLETED: { title: 'Atendimento concluído', verb: 'foi concluído' },
  CANCELED: { title: 'Agendamento cancelado', verb: 'foi cancelado pelo estabelecimento' },
  NO_SHOW: { title: 'Ausência registrada', verb: 'foi marcado como não comparecimento' },
};

/**
 * Notificações in-app (+ push no aparelho) + WhatsApp + e-mail. Sempre chamado
 * **depois** do commit e nunca lança: falha aqui não desfaz nem repete a
 * operação (Princípio XI).
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly frontendUrl = loadEnv().FRONTEND_URL;

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsappService,
    private readonly email: EmailService,
    private readonly push: PushService,
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
        url: CLIENT_URL,
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
          url: OWNER_URL,
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
        url: CLIENT_URL,
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
        url: OWNER_URL,
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

  /** Lembrete 15 min antes e na hora: cliente e dono, in-app + push + e-mail. */
  async upcoming(appointmentId: string, stage: UpcomingStage): Promise<void> {
    await this.safely(`upcoming:${stage}`, async () => {
      const a = await this.load(appointmentId);
      const time = formatTime(a.startsAt);
      const soon = stage === 'SOON';
      const place = [a.business.address, a.business.neighborhood].filter(Boolean).join(' · ');

      const clientTitle = soon
        ? 'Seu horário é daqui a 15 minutos'
        : 'Chegou a hora do seu atendimento';
      const clientBody = `${a.serviceName} em ${a.business.name}, às ${time} com ${a.professional.name}.`;
      await this.inApp(a.clientId, {
        type: soon ? 'APPOINTMENT_REMINDER_15M' : 'APPOINTMENT_REMINDER_NOW',
        title: clientTitle,
        body: clientBody,
        data: { appointmentId: a.id },
        url: CLIENT_URL,
      });
      await this.emailTo(
        a.client,
        clientTitle,
        place ? [clientBody, `Endereço: ${place}`] : [clientBody],
        { label: 'Ver meu agendamento', url: `${this.frontendUrl}${CLIENT_URL}` },
      );

      const ownerTitle = soon ? 'Atendimento em 15 minutos' : 'Atendimento começando agora';
      const ownerBody = `${a.client.name} · ${a.serviceName} · ${time} · ${a.professional.name}`;
      await this.inApp(a.business.ownerId, {
        type: soon ? 'OWNER_REMINDER_15M' : 'OWNER_REMINDER_NOW',
        title: ownerTitle,
        body: ownerBody,
        data: { appointmentId: a.id },
        url: OWNER_SCHEDULE_URL,
      });
      await this.emailTo(a.business.owner, ownerTitle, [ownerBody], {
        label: 'Abrir agenda',
        url: `${this.frontendUrl}${OWNER_SCHEDULE_URL}`,
      });
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
        url: CLIENT_URL,
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
        url: OWNER_URL,
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
        url: OWNER_URL,
      });
    });
  }

  private load(appointmentId: string): Promise<AppointmentWithParties> {
    return this.prisma.appointment.findUniqueOrThrow({
      where: { id: appointmentId },
      include: appointmentInclude,
    });
  }

  /** Grava no sino e replica como push nos aparelhos inscritos do usuário. */
  private async inApp(
    userId: string,
    {
      url,
      ...n
    }: { type: string; title: string; body: string; data?: Prisma.InputJsonValue; url: string },
  ): Promise<void> {
    await this.prisma.notification.create({ data: { userId, ...n } });
    await this.push.sendToUser(userId, { title: n.title, body: n.body, url, tag: n.type });
  }

  /**
   * E-mail só para endereço verificado e real (cliente criada no balcão tem
   * e-mail sintético). Texto vem do banco: sempre escapado.
   */
  private async emailTo(
    to: { name: string; email: string; emailVerified: boolean },
    title: string,
    paragraphs: string[],
    action: { label: string; url: string },
  ): Promise<void> {
    if (!to.emailVerified || to.email.endsWith(`@${PHONE_EMAIL_DOMAIN}`)) return;
    await this.email.send({
      to: to.email,
      subject: `${title} — belezaOur`,
      html: emailLayout(
        title,
        [`Olá, ${escapeHtml(to.name)}.`, ...paragraphs.map(escapeHtml)],
        action,
      ),
    });
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
