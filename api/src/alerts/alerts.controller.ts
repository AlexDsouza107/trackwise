import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { AuthUser } from '../common/types';
import { CurrentUser, Roles } from '../auth/auth';
import { DbService } from '../db/db.service';
import { ScannerService } from './scanner.service';

const RulePatch = z.object({ after_hours: z.number().min(0).optional(), enabled: z.boolean().optional(), email: z.boolean().optional() });

@Controller()
export class AlertsController {
  constructor(private readonly db: DbService, private readonly scanner: ScannerService) {}

  @Get('notifications')
  async mine(@CurrentUser() u: AuthUser) {
    const items = await this.db.query('select * from notifications where user_id=$1 order by id desc limit 100', [u.id]);
    const unread = await this.db.one<{ n: string }>('select count(*) n from notifications where user_id=$1 and read_at is null', [u.id]);
    return { unread: Number(unread!.n), items };
  }

  @Post('notifications/read-all')
  async readAll(@CurrentUser() u: AuthUser) {
    await this.db.query('update notifications set read_at=now() where user_id=$1 and read_at is null', [u.id]);
    return { ok: true };
  }

  @Post('notifications/:id/read')
  async read(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) {
    await this.db.query('update notifications set read_at=now() where id=$1 and user_id=$2', [id, u.id]);
    return { ok: true };
  }

  @Roles('officer', 'committee', 'admin')
  @Get('alerts')
  alerts(@Query('kind') kind?: string) {
    return this.db.query('select * from alerts where ($1::text is null or kind=$1) order by id desc limit 200', [kind ?? null]);
  }

  @Roles('admin')
  @Post('alerts/scan')
  runScan() {
    return this.scanner.scan();
  }

  @Roles('admin')
  @Get('alerts/escalation-rules')
  rules() {
    return this.db.query('select * from escalation_rules order by kind, level');
  }

  @Roles('admin')
  @Patch('alerts/escalation-rules/:id')
  async patchRule(@Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    const p = RulePatch.parse(body);
    return this.db.one(
      `update escalation_rules set after_hours=coalesce($2,after_hours), enabled=coalesce($3,enabled), email=coalesce($4,email)
        where id=$1 returning *`, [id, p.after_hours ?? null, p.enabled ?? null, p.email ?? null]);
  }

  @Roles('admin')
  @Get('alerts/emails')
  emails() {
    return this.db.query('select * from email_outbox order by id desc limit 100');
  }
}
