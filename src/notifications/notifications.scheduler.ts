import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { loadEnv } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService, type UpcomingStage } from './notifications.service';

const JOB = 'notifications-scheduler';
const BATCH = 100;
const MINUTE = 60_000;
// "Na hora" sai até 1 min antes (o tick é de 1 min) e, se o servidor ficou
// fora do ar, só até 10 min depois do início — depois disso já não ajuda.
const NOW_LEAD_MS = MINUTE;
const NOW_GRACE_MS = 10 * MINUTE;
const SOON_MS = 15 * MINUTE;

type SentField =
  | 'reminder24hSentAt'
  | 'reminder2hSentAt'
  | 'reminder15mSentAt'
  | 'startNoticeSentAt'
  | 'reviewInviteSentAt';

export interface TickResult {
  skipped?: true;
  reminders24h: number;
  reminders2h: number;
  reminders15m: number;
  startNotices: number;
  reviewInvites: number;
}

/**
 * Lembretes (24h/2h por WhatsApp; 15 min e na hora por e-mail + push + app,
 * para cliente e dono) e convite para avaliar (FR-053). Roda a cada minuto no
 * processo e também por um cron externo (POST /api/internal/cron/tick), que
 * acorda a instância quando a hospedagem a põe para dormir. Cada envio é
 * "reivindicado" com updateMany condicionado a `...SentAt IS NULL`: mesmo com
 * execuções sobrepostas (ou em duas instâncias), cada mensagem sai uma vez.
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
    // Ao acordar (deploy ou instância que dormia), não espera o primeiro intervalo.
    void this.tick();
  }

  onModuleDestroy(): void {
    if (this.registry.doesExist('interval', JOB)) this.registry.deleteInterval(JOB);
  }

  async tick(now = new Date()): Promise<TickResult> {
    const result: TickResult = {
      reminders24h: 0,
      reminders2h: 0,
      reminders15m: 0,
      startNotices: 0,
      reviewInvites: 0,
    };
    if (this.running) return { ...result, skipped: true };
    this.running = true;
    try {
      const s = await this.settings.get();
      if (s.remindersEnabled) {
        const t = now.getTime();
        // "Na hora" primeiro; a janela de 15 min começa depois dela para não
        // mandar os dois avisos no mesmo minuto.
        result.startNotices = await this.upcoming(
          now,
          'startNoticeSentAt',
          { gt: new Date(t - NOW_GRACE_MS), lte: new Date(t + NOW_LEAD_MS) },
          'NOW',
        );
        result.reminders15m = await this.upcoming(
          now,
          'reminder15mSentAt',
          { gt: new Date(t + NOW_LEAD_MS), lte: new Date(t + SOON_MS) },
          'SOON',
        );
        result.reminders24h = await this.reminders(now, 24);
        result.reminders2h = await this.reminders(now, 2);
      }
      if (s.reviewRequestEnabled) result.reviewInvites = await this.reviewInvites(now);
      // Telefones no log de envio de código só ficam o necessário para o limite diário (LGPD).
      await this.prisma.otpSendLog.deleteMany({
        where: { createdAt: { lt: new Date(now.getTime() - 24 * 3_600_000) } },
      });
    } catch (e) {
      this.logger.error(`Falha no agendador: ${e instanceof Error ? e.message : 'erro'}`);
    } finally {
      this.running = false;
    }
    return result;
  }

  /** Reivindica o envio; true só para a execução que marcou o campo. */
  private async claim(id: string, field: SentField, now: Date): Promise<boolean> {
    const { count } = await this.prisma.appointment.updateMany({
      where: { id, [field]: null },
      data: { [field]: now },
    });
    return count === 1;
  }

  private async due(field: SentField, startsAt: { gt: Date; lte: Date }): Promise<string[]> {
    const rows = await this.prisma.appointment.findMany({
      where: { status: 'CONFIRMED', startsAt, [field]: null },
      select: { id: true },
      orderBy: { startsAt: 'asc' },
      take: BATCH,
    });
    return rows.map((r) => r.id);
  }

  private async upcoming(
    now: Date,
    field: 'reminder15mSentAt' | 'startNoticeSentAt',
    startsAt: { gt: Date; lte: Date },
    stage: UpcomingStage,
  ): Promise<number> {
    let sent = 0;
    for (const id of await this.due(field, startsAt)) {
      if (await this.claim(id, field, now)) {
        await this.notifications.upcoming(id, stage);
        sent++;
      }
    }
    return sent;
  }

  private async reminders(now: Date, hours: 24 | 2): Promise<number> {
    const field = hours === 24 ? 'reminder24hSentAt' : 'reminder2hSentAt';
    let sent = 0;
    const window = { gt: now, lte: new Date(now.getTime() + hours * 3_600_000) };
    for (const id of await this.due(field, window)) {
      if (await this.claim(id, field, now)) {
        await this.notifications.reminder(id, hours);
        sent++;
      }
    }
    return sent;
  }

  private async reviewInvites(now: Date): Promise<number> {
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
    let sent = 0;
    for (const { id } of due) {
      if (await this.claim(id, 'reviewInviteSentAt', now)) {
        await this.notifications.reviewInvite(id);
        sent++;
      }
    }
    return sent;
  }
}
