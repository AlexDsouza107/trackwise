'use client';
import { Heatmap, SimpleBars, StackedAlerts, TrendChart, type HeatInst } from '@/components/charts';
import { Card, ErrorNote, Loading, PageHeader, Stat } from '@/components/ui';
import { useApi } from '@/lib/api';
import { fmtHours, humanize, STATE_LABEL } from '@/lib/format';
import type { AppState } from '@/lib/types';

interface Summary {
  totals: { open: number; approved: number; rejected: number; alerts: number; slaBreached: number; slaAtRisk: number };
  pendingByState: { state: string; count: number }[];
  avgTurnaroundHours: number | null;
  turnaroundByType: { type: string; avgHours: number | null; total: number }[];
  riskDistribution: { level: string; count: number }[];
  alertVolume: Record<string, string | number>[];
  complianceTrend: { period: string; avgScore: number }[];
  heatmap: { rules: { code: string; name: string; severity: string }[]; institutions: HeatInst[] };
}

const STAGE_ORDER = ['submitted', 'document_scrutiny', 'compliance_check', 'committee_review', 'decision', 'deficiency'];
const RISK_COLOR: Record<string, string> = { low: 'var(--good)', medium: 'var(--warn)', high: 'var(--bad)', unscored: 'var(--axis)' };

export default function Analytics() {
  const { data, error, loading } = useApi<Summary>('/analytics/summary', 30000);
  if (loading) return <Loading />;
  if (!data) return <ErrorNote message={error} />;

  const SHORT: Record<string, string> = { document_scrutiny: 'Scrutiny', compliance_check: 'Compliance', committee_review: 'Committee' };
  const pending = STAGE_ORDER.map((s) => ({ stage: SHORT[s] ?? STATE_LABEL[s as AppState], count: data.pendingByState.find((p) => p.state === s)?.count ?? 0 }));
  const turnaround = data.turnaroundByType.filter((t) => t.avgHours !== null).map((t) => ({ type: humanize(t.type), hours: Math.round(t.avgHours!) }));
  const risk = ['low', 'medium', 'high', 'unscored'].map((l) => ({ level: humanize(l), count: data.riskDistribution.find((r) => r.level === l)?.count ?? 0 }));
  const t = data.totals;

  return (
    <>
      <PageHeader title="Analytics" subtitle="Pipeline health, turnaround, compliance and alert volume across all institutions." />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Stat label="Open applications" value={t.open} />
        <Stat label="SLA breached" value={t.slaBreached} tone={t.slaBreached ? 'bad' : undefined} hint={`${t.slaAtRisk} more due within 24h`} />
        <Stat label="Avg turnaround" value={fmtHours(data.avgTurnaroundHours)} hint="submit to decision" />
        <Stat label="Approved" value={t.approved} />
        <Stat label="Rejected" value={t.rejected} />
        <Stat label="Alerts raised" value={t.alerts} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Pending applications by stage"><SimpleBars data={pending} xKey="stage" yKey="count" name="Applications" /></Card>
        <Card title="Average turnaround by type (hours, decided applications)"><SimpleBars data={turnaround} xKey="type" yKey="hours" name="Avg hours" unit="h" /></Card>
        <Card title="Open applications by AI risk level">
          <SimpleBars data={risk} xKey="level" yKey="count" name="Applications" colors={risk.map((r) => RISK_COLOR[r.level.toLowerCase()])} height={220} />
          <p className="text-xs text-muted">Bars are colored green/amber/red and labeled by level; the axis label carries the meaning, not color alone.</p>
        </Card>
        <Card title="Alert volume, last 14 days"><StackedAlerts data={data.alertVolume} /></Card>
        <Card title="Average compliance score across institutions" className="lg:col-span-2">
          <TrendChart data={data.complianceTrend} xKey="period" yKey="avgScore" name="Average score" height={220} />
        </Card>
        <Card title="Compliance heatmap" className="lg:col-span-2"><Heatmap rules={data.heatmap.rules} institutions={data.heatmap.institutions} /></Card>
      </div>
    </>
  );
}
