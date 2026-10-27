'use client';
import { useState } from 'react';
import { groupAlertVolume, Heatmap, SimpleBars, StackedAlerts, TrendChart, type HeatInst } from '@/components/charts';
import { Card, ErrorNote, Loading, PageHeader, Stat } from '@/components/ui';
import { useApi } from '@/lib/api';
import { useUser } from '@/lib/auth';
import { fmtHours, humanize, REGIONS, STATE_LABEL } from '@/lib/format';
import type { AppState } from '@/lib/types';

interface RegionRow { region: string; institutions: number; open: number; approved: number; rejected: number; slaBreached: number; avgTurnaroundHours: number | null; avgCompliance: number | null }
interface Summary {
  region: string | null;
  byRegion: RegionRow[];
  evc: { awaitingSchedule: number; upcoming7d: number; reportOverdue: number; completed: number };
  documentValidity: { expired: number; expiringSoon: number; renewalPending: number; total: number };
  totals: { open: number; approved: number; rejected: number; alerts: number; slaBreached: number; slaAtRisk: number };
  pendingByState: { state: string; count: number }[];
  avgTurnaroundHours: number | null;
  turnaroundByType: { type: string; avgHours: number | null; total: number }[];
  riskDistribution: { level: string; count: number }[];
  alertVolume: Record<string, string | number>[];
  complianceTrend: { period: string; avgScore: number }[];
  heatmap: { rules: { code: string; name: string; severity: string }[]; institutions: HeatInst[] };
}

const STAGE_ORDER = ['submitted', 'document_scrutiny', 'compliance_check', 'evc_visit', 'committee_review', 'decision', 'deficiency'];
const RISK_COLOR: Record<string, string> = { low: 'var(--good)', medium: 'var(--warn)', high: 'var(--bad)', unscored: 'var(--axis)' };

export default function Analytics() {
  const user = useUser();
  const pinned = user.role === 'regional';
  const [region, setRegion] = useState('');
  const { data, error, loading } = useApi<Summary>(`/analytics/summary${region && !pinned ? `?region=${region}` : ''}`, 30000);
  if (loading) return <Loading />;
  if (!data) return <ErrorNote message={error} />;

  const SHORT: Record<string, string> = { document_scrutiny: 'Scrutiny', compliance_check: 'Checks', evc_visit: 'EVC', committee_review: 'Committee' };
  const pending = STAGE_ORDER.map((s) => ({ stage: SHORT[s] ?? STATE_LABEL[s as AppState], count: data.pendingByState.find((p) => p.state === s)?.count ?? 0 }));
  const turnaround = data.turnaroundByType.filter((t) => t.avgHours !== null).map((t) => ({ type: humanize(t.type), hours: Math.round(t.avgHours!) }));
  const risk = ['low', 'medium', 'high', 'unscored'].map((l) => ({ level: humanize(l), count: data.riskDistribution.find((r) => r.level === l)?.count ?? 0 }));
  const t = data.totals;

  return (
    <>
      <PageHeader title="Analytics" subtitle={`Pipeline health, turnaround, compliance and alert volume ${data.region ? `for the ${data.region} region` : 'across all regions and institutions'}.`}
        action={pinned ? <span className="rounded-full bg-brand-soft px-3 py-1 text-[12px] font-medium text-brand">{user.region} region</span> : (
          <select className="input !w-auto !py-1.5 text-[13px]" aria-label="Region" value={region} onChange={(e) => setRegion(e.target.value)}>
            <option value="">All regions</option>{REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>)} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Stat label="Open applications" value={t.open} />
        <Stat label="SLA breached" value={t.slaBreached} tone={t.slaBreached ? 'bad' : undefined} hint={`${t.slaAtRisk} more due within 24h`} />
        <Stat label="Avg turnaround" value={fmtHours(data.avgTurnaroundHours)} hint="submit to decision" />
        <Stat label="Approved" value={t.approved} />
        <Stat label="Rejected" value={t.rejected} />
        <Stat label="Alerts raised" value={t.alerts} />
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
        <Stat label="Visits to schedule" value={data.evc.awaitingSchedule} tone={data.evc.awaitingSchedule ? 'bad' : undefined} />
        <Stat label="Visits in 7 days" value={data.evc.upcoming7d} />
        <Stat label="EVC reports overdue" value={data.evc.reportOverdue} tone={data.evc.reportOverdue ? 'bad' : undefined} />
        <Stat label="Documents expired" value={data.documentValidity.expired} tone={data.documentValidity.expired ? 'bad' : undefined} hint={`of ${data.documentValidity.total} tracked`} />
        <Stat label="Expiring in 90 days" value={data.documentValidity.expiringSoon} />
        <Stat label="Renewals to verify" value={data.documentValidity.renewalPending} />
        <Stat label="Visit reports filed" value={data.evc.completed} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Region-wise processing performance" className="lg:col-span-2">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-line"><tr>
                <th className="th">Region</th><th className="th text-right">Institutions</th><th className="th text-right">Open</th><th className="th text-right">Approved</th>
                <th className="th text-right">Rejected</th><th className="th text-right">SLA breached</th><th className="th text-right">Avg turnaround</th><th className="th text-right">Avg compliance</th>
              </tr></thead>
              <tbody className="divide-y divide-line">
                {data.byRegion.map((r) => (
                  <tr key={r.region}>
                    <td className="td font-medium">{r.region}</td><td className="td text-right">{r.institutions}</td><td className="td text-right">{r.open}</td>
                    <td className="td text-right">{r.approved}</td><td className="td text-right">{r.rejected}</td>
                    <td className={`td text-right ${r.slaBreached ? 'font-medium text-bad-text' : ''}`}>{r.slaBreached ? `✕ ${r.slaBreached}` : '0'}</td>
                    <td className="td text-right">{fmtHours(r.avgTurnaroundHours)}</td><td className="td text-right">{r.avgCompliance ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="Pending applications by stage"><SimpleBars data={pending} xKey="stage" yKey="count" name="Applications" /></Card>
        <Card title="Average turnaround by type (hours, decided applications)"><SimpleBars data={turnaround} xKey="type" yKey="hours" name="Avg hours" unit="h" /></Card>
        <Card title="Open applications by AI risk level">
          <SimpleBars data={risk} xKey="level" yKey="count" name="Applications" colors={risk.map((r) => RISK_COLOR[r.level.toLowerCase()])} height={220} />
          <p className="text-xs text-muted">Bars are colored green/amber/red and labeled by level; the axis label carries the meaning, not color alone.</p>
        </Card>
        <Card title="Alert volume, last 14 days"><StackedAlerts data={groupAlertVolume(data.alertVolume)} /></Card>
        <Card title="Average compliance score across institutions" className="lg:col-span-2">
          <TrendChart data={data.complianceTrend} xKey="period" yKey="avgScore" name="Average score" height={220} />
        </Card>
        <Card title="Compliance heatmap" className="lg:col-span-2"><Heatmap rules={data.heatmap.rules} institutions={data.heatmap.institutions} /></Card>
      </div>
    </>
  );
}
