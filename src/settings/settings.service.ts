import { Global, Injectable, Module } from '@nestjs/common';
import type { PlatformSetting, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const GLOBAL_ID = 'global';

/** Configurações globais da plataforma (linha única). */
@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  get(tx: Prisma.TransactionClient = this.prisma): Promise<PlatformSetting> {
    return tx.platformSetting.upsert({
      where: { id: GLOBAL_ID },
      create: { id: GLOBAL_ID },
      update: {},
    });
  }

  async update(data: Prisma.PlatformSettingUpdateInput): Promise<PlatformSetting> {
    await this.get();
    return this.prisma.platformSetting.update({ where: { id: GLOBAL_ID }, data });
  }
}

@Global()
@Module({ providers: [SettingsService], exports: [SettingsService] })
export class SettingsModule {}
