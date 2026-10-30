import { Global, Module } from '@nestjs/common';
import { EmailService } from './email/email.service';
import { PushService } from './push/push.service';
import { StorageService } from './storage/storage.service';
import { WhatsappService } from './whatsapp/whatsapp.service';

@Global()
@Module({
  providers: [EmailService, WhatsappService, StorageService, PushService],
  exports: [EmailService, WhatsappService, StorageService, PushService],
})
export class IntegrationsModule {}
