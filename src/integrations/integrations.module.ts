import { Global, Module } from '@nestjs/common';
import { EmailService } from './email/email.service';
import { StorageService } from './storage/storage.service';
import { WhatsappService } from './whatsapp/whatsapp.service';

@Global()
@Module({
  providers: [EmailService, WhatsappService, StorageService],
  exports: [EmailService, WhatsappService, StorageService],
})
export class IntegrationsModule {}
