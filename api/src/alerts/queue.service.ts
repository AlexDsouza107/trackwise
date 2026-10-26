import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '../config';
import { DbService } from '../db/db.service';

@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Queues');
  private readonly connection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
  readonly email = new Queue('email', { connection: this.connection });
  readonly scan = new Queue('alert-scan', { connection: this.connection });
  private workers: Worker[] = [];
  private scanHandler: (() => Promise<unknown>) | null = null;

  constructor(private readonly db: DbService) {}

  /** The scanner registers itself here to avoid a circular provider dependency. */
  setScanHandler(fn: () => Promise<unknown>): void {
    this.scanHandler = fn;
  }

  async onModuleInit(): Promise<void> {
    this.workers.push(
      new Worker(
        'email',
        async (job) => {
          const mail = await this.db.one<{ to_email: string; subject: string }>(
            "update email_outbox set status='sent', sent_at=now() where id=$1 returning to_email, subject",
            [job.data.id],
          );
          if (mail) this.log.log(`[EMAIL STUB] to=${mail.to_email} subject="${mail.subject}"`);
        },
        { connection: this.connection },
      ),
      new Worker(
        'alert-scan',
        async () => {
          await this.scanHandler?.();
        },
        { connection: this.connection },
      ),
    );
    for (const w of this.workers) w.on('failed', (job, err) => this.log.error(`${w.name} job ${job?.id} failed: ${err.message}`));
    await this.scan.upsertJobScheduler('periodic-scan', { every: config.alertScanIntervalMs });
    this.log.log(`Alert scan scheduled every ${config.alertScanIntervalMs}ms`);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.close()));
    await Promise.all([this.email.close(), this.scan.close()]);
    this.connection.disconnect();
  }
}
