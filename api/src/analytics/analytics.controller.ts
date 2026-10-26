import { Controller, Get } from '@nestjs/common';
import { Roles } from '../auth/auth';
import { ComplianceService } from '../compliance/compliance.service';
import { DbService } from '../db/db.service';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly db: DbService, private readonly compliance: ComplianceService) {}

  @Roles('officer', 'committee', 'admin')
  @Get('summary')
  async summary() {
    const [byState, turnaround, byType, sla, risk, alertsByDay, complianceTrend, totals] = await Promise.all([
      this.db.query<{ state: string; n: string }>(
        `select state, count(*) n from applications where state <> 'draft' group by state`),
      this.db.one<{ avg_hours: string | null; n: string }>(
        `select avg(extract(epoch from (decided_at - submitted_at))/3600) avg_hours, count(*) n
           from applications where decided_at is not null and submitted_at is not null`),
      this.db.query<{ type: string; avg_hours: string | null; total: string }>(
        `select type, avg(extract(epoch from (decided_at - submitted_at))/3600) filter (where decided_at is not null) avg_hours, count(*) total
           from applications where state <> 'draft' group by type order by type`),
      this.db.one<{ breached: string; at_risk: string }>(
        `select count(*) filter (where sla_due_at < now()) breached,
                count(*) filter (where sla_due_at >= now() and sla_due_at < now() + interval '24 hours') at_risk
           from applications where state not in ('draft','approved','rejected')`),
      this.db.query<{ level: string; n: string }>(
        `select coalesce(risk_level,'unscored') level, count(*) n from applications
          where state not in ('draft','approved','rejected') group by 1`),
      this.db.query<{ day: Date; kind: string; n: string }>(
        `select date_trunc('day', created_at) day, kind, count(*) n from alerts
          where created_at > now() - interval '14 days' group by 1,2 order by 1`),
      this.db.query<{ period: Date; avg: string }>(
        `select period, avg(score) avg from compliance_scores group by period order by period`),
      this.db.one<{ approved: string; rejected: string; open: string; alerts: string }>(
        `select count(*) filter (where state='approved') approved, count(*) filter (where state='rejected') rejected,
                count(*) filter (where state not in ('draft','approved','rejected')) open,
                (select count(*) from alerts) alerts from applications`),
    ]);
    const overview = await this.compliance.overview();

    const days = new Map<string, Record<string, number>>();
    for (const r of alertsByDay) {
      const k = r.day.toISOString().slice(0, 10);
      days.set(k, { ...(days.get(k) ?? {}), [r.kind]: Number(r.n) });
    }
    return {
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
      heatmap: overview,
    };
  }
}
