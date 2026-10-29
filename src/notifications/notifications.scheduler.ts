import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { loadEnv } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from './notifications.service';

const JOB = 'notifications-scheduler';
const BATCH = 100;

/**
 * Lembretes 24h/2h e convite para avaliar (FR-053). Cada envio é
 * "reivindicado" com updateMany condicionado a `...SentAt IS NULL`: mesmo com
 * execuções sobrepostas, cada mensagem sai uma única vez.
 */
@Injectable()
export class NotificationsScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(NotificationsScheduler.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly registry: SchedulerRegistry,
  ) {}

  onApplicationBootstrap(): void {
    const interval = setInterval(() => void this.tick(), loadEnv().SCHEDULER_INTERVAL_MS);
    this.registry.addInterval(JOB, interval);
  }

  onModuleDestroy(): void {
    if (this.registry.doesExist('interval', JOB)) this.registry.deleteInterval(JOB);
  }

  async tick(now = new Date()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const s = await this.settings.get();
      if (s.remindersEnabled) {
        await this.reminders(now, 24);
        await this.reminders(now, 2);
      }
      if (s.reviewRequestEnabled) await this.reviewInvites(now);
      // Telefones no log de envio de código só ficam o necessário para o limite diário (LGPD).
      await this.prisma.otpSendLog.deleteMany({
        where: { createdAt: { lt: new Date(now.getTime() - 24 * 3_600_000) } },
      });
    } catch (e) {
      this.logger.error(`Falha no agendador: ${e instanceof Error ? e.message : 'erro'}`);
    } finally {
      this.running = false;
    }
  }

  private async reminders(now: Date, hours: 24 | 2): Promise<void> {
    const field = hours === 24 ? 'reminder24hSentAt' : 'reminder2hSentAt';
    const due = await this.prisma.appointment.findMany({
      where: {
        status: 'CONFIRMED',
        startsAt: { gt: now, lte: new Date(now.getTime() + hours * 3_600_000) },
        [field]: null,
      },
      select: { id: true },
      take: BATCH,
    });
    for (const { id } of due) {
      const { count } = await this.prisma.appointment.updateMany({
        where: { id, [field]: null },
        data: { [field]: now },
      });
      if (count === 1) await this.notifications.reminder(id, hours);
    }
  }

  private async reviewInvites(now: Date): Promise<void> {
    const due = await this.prisma.appointment.findMany({
      where: {
        status: 'COMPLETED',
        completedAt: { lte: new Date(now.getTime() - 2 * 3_600_000) },
        reviewInviteSentAt: null,
        review: null,
      },
      select: { id: true },
      take: BATCH,
    });
    for (const { id } of due) {
      const { count } = await this.prisma.appointment.updateMany({
        where: { id, reviewInviteSentAt: null },
        data: { reviewInviteSentAt: now },
      });
      if (count === 1) await this.notifications.reviewInvite(id);
    }
  }
}
