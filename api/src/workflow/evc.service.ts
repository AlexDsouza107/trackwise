import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { NotificationsService } from '../alerts/notifications.service';
import { assertRegionAccess, effectiveRegion } from '../common/access';
import { AuthUser } from '../common/types';
import { DbService } from '../db/db.service';

export const ScheduleDto = z.object({
  scheduledFor: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date'),
  venue: z.string().min(2).max(200),
  memberIds: z.array(z.number().int()).min(1).max(5),
});
export const ReportDto = z.object({
  outcome: z.enum(['satisfactory', 'minor_gaps', 'major_gaps']),
  findings: z.string().min(10).max(4000),
});

export interface EvcReport { outcome: 'satisfactory' | 'minor_gaps' | 'major_gaps'; findings: string; filedBy: string; filedAt: string }
export interface EvcVisitRow {
  id: number; application_id: number; round: number; status: 'awaiting_schedule' | 'scheduled' | 'completed';
  scheduled_for: Date | null; venue: string | null; member_ids: number[]; scheduled_by_name: string | null;
  scheduled_at: Date | null; report: EvcReport | null;
}
export type EvcVisit = EvcVisitRow & { members: { id: number; name: string }[] };

interface Ctx { id: number; reference: string; title: string; state: string; institution_id: number; region: string | null; institution_name: string }

/** Expert Visit Committee: scheduling, member assignment and the visit report. Reminders and escalation live in the alert scanner. */
@Injectable()
export class EvcService {
  constructor(private readonly db: DbService, private readonly notifications: NotificationsService) {}

  async forApplication(appId: number): Promise<EvcVisit | null> {
    const v = await this.db.one<EvcVisitRow>('select * from evc_visits where application_id=$1', [appId]);
    if (!v) return null;
    const members = v.member_ids.length
      ? await this.db.query<{ id: number; name: string }>('select id, name from users where id = any($1) order by name', [v.member_ids])
      : [];
    return { ...v, members };
  }

  /** (Re)opens the visit record when an application enters the EVC stage; a repeat visit after a deficiency starts a new round. */
  async open(appId: number): Promise<void> {
    await this.db.query(
      `insert into evc_visits (application_id) values ($1)
       on conflict (application_id) do update set round = evc_visits.round + 1, status='awaiting_schedule', scheduled_for=null,
         venue=null, member_ids='{}', scheduled_by_name=null, scheduled_at=null, report=null`, [appId]);
  }

  async committeeMembers() {
    return this.db.query<{ id: number; name: string }>("select id, name from users where role='committee' order by name");
  }

  private async context(appId: number): Promise<Ctx> {
    const c = await this.db.one<Ctx>(
      `select a.id, a.reference, a.title, a.state, a.institution_id, i.region, i.name as institution_name
         from applications a join institutions i on i.id=a.institution_id where a.id=$1`, [appId]);
    if (!c) throw new NotFoundException('Application not found');
    return c;
  }

  private async audit(appId: number, event: string, actor: AuthUser, note: string, at: Date) {
    await this.db.query(
      `insert into audit_log (application_id, event, from_state, to_state, actor_id, actor_name, actor_role, note, created_at)
       values ($1,$2,'evc_visit','evc_visit',$3,$4,$5,$6,$7)`, [appId, event, actor.id || null, actor.name, actor.role, note, at]);
  }

  async schedule(user: AuthUser, appId: number, input: z.infer<typeof ScheduleDto>, at = new Date()) {
    const c = await this.context(appId);
    if (user.role !== 'regional' && user.role !== 'admin') throw new ForbiddenException('Only regional officers or admins schedule EVC visits');
    assertRegionAccess(user, c.region);
    if (c.state !== 'evc_visit') throw new BadRequestException('The application is not in the EVC stage');
    const when = new Date(input.scheduledFor);
    if (when.getTime() < at.getTime() - 60_000) throw new BadRequestException('The visit date must not be in the past');
    const members = await this.db.query<{ id: number; name: string }>(
      "select id, name from users where role='committee' and id = any($1)", [input.memberIds]);
    if (members.length !== new Set(input.memberIds).size) throw new BadRequestException('Visit members must be committee members');
    await this.db.query(
      `update evc_visits set status='scheduled', scheduled_for=$2, venue=$3, member_ids=$4, scheduled_by_name=$5, scheduled_at=$6, report=null
        where application_id=$1`, [appId, when, input.venue, members.map((m) => m.id), user.name, at]);
    const day = when.toISOString().slice(0, 16).replace('T', ' ');
    await this.audit(appId, 'EVC_SCHEDULED', user, `Visit on ${day} UTC at ${input.venue}; members: ${members.map((m) => m.name).join(', ')}`, at);
    const link = `/applications/${appId}`;
    await this.notifications.notifyInstitution(c.institution_id, {
      kind: 'EVC', title: `Expert visit scheduled: ${c.reference}`, link, email: true,
      body: `An Expert Visit Committee will visit ${c.institution_name} on ${day} UTC (${input.venue}).`,
    });
    await this.notifications.notifyUsers(members.map((m) => m.id), {
      kind: 'EVC', title: `You are assigned to an EVC visit: ${c.reference}`, link,
      body: `Visit to ${c.institution_name} on ${day} UTC (${input.venue}).`,
    });
    return this.forApplication(appId);
  }

  async report(user: AuthUser, appId: number, input: z.infer<typeof ReportDto>, at = new Date()) {
    const c = await this.context(appId);
    const visit = await this.forApplication(appId);
    if (!visit || c.state !== 'evc_visit') throw new BadRequestException('The application is not in the EVC stage');
    if (visit.status === 'awaiting_schedule') throw new BadRequestException('Schedule the visit before recording its report');
    const allowed = user.role === 'admin' || (user.role === 'regional' && user.region === c.region)
      || (user.role === 'committee' && visit.member_ids.includes(user.id));
    if (!allowed) throw new ForbiddenException('Only assigned visit members, the regional officer or an admin can record the report');
    const report: EvcReport = { ...input, filedBy: user.name, filedAt: at.toISOString() };
    await this.db.query("update evc_visits set status='completed', report=$2 where application_id=$1", [appId, JSON.stringify(report)]);
    await this.audit(appId, 'EVC_REPORT_FILED', user, `${input.outcome.replace('_', ' ')}: ${input.findings}`, at);
    await this.notifications.notifyRole('regional', {
      kind: 'EVC', title: `EVC report filed: ${c.reference}`, link: `/applications/${appId}`,
      body: `The visit report is in (${input.outcome.replace('_', ' ')}). Complete the EVC stage or raise a deficiency.`,
    }, c.region);
    return this.forApplication(appId);
  }

  /** Visits across applications for the EVC page. Regional officers only ever see their own region. */
  async list(user: AuthUser, region?: string, status?: string) {
    const r = effectiveRegion(user, region);
    return this.db.query(
      `select v.id, v.status, v.round, v.scheduled_for, v.venue, v.report->>'outcome' as outcome,
              a.id as application_id, a.reference, a.title, a.state, a.sla_due_at,
              i.name as institution_name, i.city, i.region,
              coalesce((select array_agg(u.name order by u.name) from users u where u.id = any(v.member_ids)), '{}') as members
         from evc_visits v join applications a on a.id=v.application_id join institutions i on i.id=a.institution_id
        where ($1::text is null or i.region=$1) and ($2::text is null or v.status=$2)
        order by (a.state <> 'evc_visit'), coalesce(v.scheduled_for, a.sla_due_at) asc nulls last limit 200`,
      [r, status ?? null]);
  }
}
