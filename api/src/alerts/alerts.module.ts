import { Module } from '@nestjs/common';
import { AlertsController } from './alerts.controller';
import { NotificationsService } from './notifications.service';
import { QueueService } from './queue.service';
import { ScannerService } from './scanner.service';

@Module({
  controllers: [AlertsController],
  providers: [QueueService, NotificationsService, ScannerService],
  exports: [NotificationsService, ScannerService],
})
export class AlertsModule {}
