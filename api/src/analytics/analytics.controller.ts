import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser, Roles } from '../auth/auth';
import { effectiveRegion } from '../common/access';
import { AuthUser } from '../common/types';
import { ComplianceService } from '../compliance/compliance.service';
import { DbService } from '../db/db.service';
import { EXPIRING_SOON_DAYS } from '../validity/validity.service';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly db: DbService, private readonly compliance: ComplianceService) {}

  @Roles('officer', 'committee', 'regional', 'admin')
  @Get('summary')
  async summary(@CurrentUser() user: AuthUser, @Query('region') regionQuery?: string) {
    const region = effectiveRegion(user, regionQuery);
    const R = [region]; // every query below takes the optional region as $1
    const scope = '($1::text is null or i.region = $1)';
    const [byState, turnaround, byType, sla, risk, alertsByDay, complianceTrend, totals, byRegion, evc, docs] = await Promise.all([
      this.db.query<{ state: string; n: string }>(
        `select a.state, count(*) n from applications a join institutions i on i.id=a.institution_id
          where a.state <> 'draft' and ${scope} group by a.state`, R),
      this.db.one<{ avg_hours: string | null; n: string }>(
        `select avg(extract(epoch from (a.decided_at - a.submitted_at))/3600) avg_hours, count(*) n
           from applications a join institutions i on i.id=a.institution_id
          where a.decided_at is not null and a.submitted_at is not null and ${scope}`, R),
      this.db.query<{ type: string; avg_hours: string | null; total: string }>(
        `select a.type, avg(extract(epoch from (a.decided_at - a.submitted_at))/3600) filter (where a.decided_at is not null) avg_hours, count(*) total
           from applications a join institutions i on i.id=a.institution_id
          where a.state <> 'draft' and ${scope} group by a.type order by a.type`, R),
      this.db.one<{ breached: string; at_risk: string }>(
        `select count(*) filter (where a.sla_due_at < now()) breached,
                count(*) filter (where a.sla_due_at >= now() and a.sla_due_at < now() + interval '24 hours') at_risk
           from applications a join institutions i on i.id=a.institution_id
          where a.state not in ('draft','approved','rejected') and ${scope}`, R),
      this.db.query<{ level: string; n: string }>(
        `select coalesce(a.risk_level,'unscored') level, count(*) n from applications a join institutions i on i.id=a.institution_id
          where a.state not in ('draft','approved','rejected') and ${scope} group by 1`, R),
      this.db.query<{ day: Date; kind: string; n: string }>(
        `select date_trunc('day', al.created_at) as day, al.kind, count(*) n from alerts al
          where al.created_at > now() - interval '14 days' and ($1::text is null or
            (al.entity_type = 'application' and al.entity_id in (select a.id from applications a join institutions i on i.id=a.institution_id where i.region=$1))
            or (al.entity_type = 'institution' and al.entity_id in (select id from institutions where region=$1))
            or (al.entity_type = 'document' and al.entity_id in (select d.id from institution_documents d join institutions i on i.id=d.institution_id where i.region=$1)))
          group by 1,2 order by 1`, R),
      this.db.query<{ period: Date; avg: string }>(
        `select cs.period, avg(cs.score) avg from compliance_scores cs join institutions i on i.id=cs.institution_id
          where ${scope} group by cs.period order by cs.period`, R),
      this.db.one<{ approved: string; rejected: string; open: string; alerts: string }>(
        `select count(*) filter (where a.state='approved') approved, count(*) filter (where a.state='rejected') rejected,
                count(*) filter (where a.state not in ('draft','approved','rejected')) open,
                (select count(*) from alerts) alerts
           from applications a join institutions i on i.id=a.institution_id where ${scope}`, R),
      this.db.query<{ region: string; open: string; approved: string; rejected: string; breached: string; avg_hours: string | null; institutions: string; compliance: string | null }>(
        `select i.region,
                count(a.id) filter (where a.state not in ('draft','approved','rejected')) open,
                count(a.id) filter (where a.state='approved') approved,
                count(a.id) filter (where a.state='rejected') rejected,
                count(a.id) filter (where a.state not in ('draft','approved','rejected') and a.sla_due_at < now()) breached,
                avg(extract(epoch from (a.decided_at - a.submitted_at))/3600) filter (where a.decided_at is not null) avg_hours,
                count(distinct i.id) institutions,
                (select avg(cs.score) from compliance_scores cs join institutions i2 on i2.id=cs.institution_id
                  where i2.region=i.region and cs.period=(select max(period) from compliance_scores)) compliance
           from institutions i left join applications a on a.institution_id=i.id and a.state <> 'draft'
          where i.region is not null and ($1::text is null or i.region=$1) group by i.region order by i.region`, R),
      this.db.one<{ awaiting: string; upcoming: string; report_overdue: string; completed: string }>(
        `select count(*) filter (where a.state='evc_visit' and v.status='awaiting_schedule') awaiting,
                count(*) filter (where a.state='evc_visit' and v.status='scheduled' and v.scheduled_for >= now() and v.scheduled_for < now() + interval '7 days') upcoming,
                count(*) filter (where a.state='evc_visit' and v.status='scheduled' and v.scheduled_for < now()) report_overdue,
                count(*) filter (where v.status='completed') completed
           from evc_visits v join applications a on a.id=v.application_id join institutions i on i.id=a.institution_id where ${scope}`, R),
      this.db.query<{ valid_until: Date; renewal: unknown }>(
        `select d.valid_until, d.renewal from institution_documents d join institutions i on i.id=d.institution_id where ${scope}`, R),
    ]);
    const overview = await this.compliance.overview(region);

    const days = new Map<string, Record<string, number>>();
    for (const r of alertsByDay) {
      const k = r.day.toISOString().slice(0, 10);
      days.set(k, { ...(days.get(k) ?? {}), [r.kind]: Number(r.n) });
    }
    const now = Date.now();
    const daysLeft = (d: Date) => Math.round((d.getTime() - now) / 86_400_000);
    return {
      region,
      totals: {
        open: Number(totals!.open), approved: Number(totals!.approved), rejected: Number(totals!.rejected),
        alerts: Number(totals!.alerts), slaBreached: Number(sla!.breached), slaAtRisk: Number(sla!.at_risk),
      },
      pendingByState: byState.map((r) => ({ state: r.state, count: Number(r.n) })),
      avgTurnaroundHours: turnaround?.avg_hours ? Number(turnaround.avg_hours) : null,
      turnaroundByType: byType.map((r) => ({ type: r.type, avgHours: r.avg_hours ? Number(r.avg_hours) : null, total: Number(r.total) })),
      riskDistribution: risk.map((r) => ({ level: r.level, count: Number(r.n) })),
      alertVolume: [...days.entries()].map(([day, kinds]) => ({ day, ...kinds })),
      complianceTrend: complianceTrend.map((r) => ({ period: r.period.toISOString().slice(0, 7), avgScore: Math.round(Number(r.avg) * 10) / 10 })),
      byRegion: byRegion.map((r) => ({
        region: r.region, institutions: Number(r.institutions), open: Number(r.open), approved: Number(r.approved), rejected: Number(r.rejected),
        slaBreached: Number(r.breached), avgTurnaroundHours: r.avg_hours ? Number(r.avg_hours) : null,
        avgCompliance: r.compliance ? Math.round(Number(r.compliance) * 10) / 10 : null,
      })),
      evc: { awaitingSchedule: Number(evc!.awaiting), upcoming7d: Number(evc!.upcoming), reportOverdue: Number(evc!.report_overdue), completed: Number(evc!.completed) },
      documentValidity: {
        expired: docs.filter((d) => !d.renewal && daysLeft(d.valid_until) < 0).length,
        expiringSoon: docs.filter((d) => !d.renewal && daysLeft(d.valid_until) >= 0 && daysLeft(d.valid_until) <= EXPIRING_SOON_DAYS).length,
        renewalPending: docs.filter((d) => d.renewal).length,
        total: docs.length,
      },
      heatmap: overview,
    };
  }
}
