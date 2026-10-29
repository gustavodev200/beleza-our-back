import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  actorId: string;
  action: string;
  targetType: string;
  targetId?: string;
  summary?: Prisma.InputJsonValue;
  ip?: string;
}

/** Registro de toda ação administrativa que altera dados (FR-067). */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Aceita um client de transação para gravar junto com a mudança auditada. */
  async record(entry: AuditEntry, tx: Prisma.TransactionClient = this.prisma): Promise<void> {
    await tx.auditLog.create({
      data: {
        actorId: entry.actorId,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        summary: entry.summary,
        ip: entry.ip,
      },
    });
    this.logger.log(
      `${entry.action} ${entry.targetType}:${entry.targetId ?? '-'} por ${entry.actorId}`,
    );
  }
}

@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}

/** Converte um objeto qualquer (DTO, entidade) em JSON serializável para o resumo da auditoria. */
export function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}
