import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { Role } from '../common/types';
import { QueueService } from './queue.service';

export interface NotificationInput {
  kind: string;
  severity?: 'info' | 'warning' | 'critical';
  title: string;
  body: string;
  link?: string;
  dedupeKey?: string;
  email?: boolean;
}

@Injectable()
export class NotificationsService {
  constructor(private readonly db: DbService, private readonly queues: QueueService) {}

  async notifyUsers(userIds: number[], n: NotificationInput): Promise<number> {
    let created = 0;
    for (const userId of new Set(userIds)) {
      const row = await this.db.one<{ id: number; email: string }>(
        `with ins as (
           insert into notifications (user_id, kind, severity, title, body, link, dedupe_key)
           values ($1,$2,$3,$4,$5,$6,$7) on conflict (user_id, dedupe_key) do nothing returning id)
         select ins.id, u.email from ins join users u on u.id = $1`,
        [userId, n.kind, n.severity ?? 'info', n.title, n.body, n.link ?? null, n.dedupeKey ?? null],
      );
      if (!row) continue;
      created++;
      if (n.email) await this.queueEmail(row.email, `[TrackWise] ${n.title}`, n.body);
    }
    return created;
  }

  /** Users with a role; when a region is given, only those bound to that region. */
  async usersWithRole(role: Role, region?: string | null): Promise<number[]> {
    return (await this.db.query<{ id: number }>(
      'select id from users where role=$1 and ($2::text is null or region=$2)', [role, region ?? null])).map((r) => r.id);
  }

  async institutionUsers(institutionId: number): Promise<number[]> {
    return (await this.db.query<{ id: number }>('select id from users where institution_id=$1', [institutionId])).map(
      (r) => r.id,
    );
  }

  async notifyRole(role: Role, n: NotificationInput, region?: string | null): Promise<number> {
    return this.notifyUsers(await this.usersWithRole(role, region), n);
  }

  async notifyInstitution(institutionId: number, n: NotificationInput): Promise<number> {
    return this.notifyUsers(await this.institutionUsers(institutionId), n);
  }

  /** Email is a stub: persisted to the outbox, then "sent" (logged) by the BullMQ email worker. */
  async queueEmail(to: string, subject: string, body: string): Promise<void> {
    const row = await this.db.one<{ id: number }>(
      'insert into email_outbox (to_email, subject, body) values ($1,$2,$3) returning id',
      [to, subject, body],
    );
    await this.queues.email.add('send', { id: row!.id }, { attempts: 3, backoff: { type: 'exponential', delay: 2000 } });
  }
}
