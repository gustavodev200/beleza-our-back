import { Global, Module } from '@nestjs/common';
import { CronController } from './cron.controller';
import { NotificationsController } from './notifications.controller';
import { NotificationsScheduler } from './notifications.scheduler';
import { NotificationsService } from './notifications.service';
import { PushSubscriptionsController } from './push-subscriptions.controller';

@Global()
@Module({
  controllers: [NotificationsController, PushSubscriptionsController, CronController],
  providers: [NotificationsService, NotificationsScheduler],
  exports: [NotificationsService],
})
export class NotificationsModule {}
