'use client';
import { useEffect, useState } from 'react';
import { Heatmap, TrendChart, type HeatInst } from '@/components/charts';
import { Card, Chip, ErrorNote, Loading, PageHeader } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { useUser } from '@/lib/auth';
import RegistryCheck from '@/components/RegistryCheck';
import { fmtDate, humanize, REGIONS } from '@/lib/format';

interface Overview { rules: { code: string; name: string; severity: string }[]; institutions: (HeatInst & { code: string; approval_valid_until: string | null })[] }
interface Detail {
  institution: { id: number; name: string; city: string; state: string; approval_valid_until: string | null };
  trend: { period: string; score: number }[];
  results: { rule_code: string; name: string; severity: string; passed: boolean; score: string; detail: string; evaluated_at: string }[];
  metrics: { period: string; faculty_count: number; student_count: number; built_up_sqm: number; lab_count: number; annual_fee: number }[];
}

export default function CompliancePage() {
  const user = useUser();
  const staff = user.role !== 'institution';
  const [region, setRegion] = useState('');
  const pinned = user.role === 'regional';
  const overview = useApi<Overview>(staff ? `/compliance/overview${region && !pinned ? `?region=${region}` : ''}` : null);
  const [selected, setSelected] = useState<number | null>(staff ? null : user.institutionId);
  const detail = useApi<Detail>(selected ? `/compliance/institutions/${selected}` : null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { if (staff && !selected && overview.data?.institutions[0]) setSelected(overview.data.institutions[0].id); }, [staff, selected, overview.data]);

  async function reevaluate() {
    setBusy(true); setErr(null);
    try { await api(`/compliance/institutions/${selected}/evaluate`, { method: 'POST' }); await Promise.all([detail.reload(), overview.reload()]); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  const latestMetrics = detail.data?.metrics.at(-1);
  return (
    <>
      <PageHeader title="Compliance monitoring" subtitle="Rules evaluated per institution each period: faculty ratio, infrastructure, accreditation validity and fee norms (illustrative thresholds)." />
      <div className="space-y-4">
        {staff && (
          <Card title={`Compliance heatmap${pinned ? ` · ${user.region} region` : ''}`} action={!pinned ? (
            <select className="input !w-auto !py-1 text-[13px]" aria-label="Region" value={region} onChange={(e) => { setRegion(e.target.value); setSelected(null); }}>
              <option value="">All regions</option>{REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>) : undefined}>
            {overview.loading && <Loading />}
            <ErrorNote message={overview.error} />
            {overview.data && <Heatmap rules={overview.data.rules} institutions={overview.data.institutions} onSelect={setSelected} selectedId={selected} />}
          </Card>
        )}
        {selected && (
          <Card title={detail.data ? detail.data.institution.name : 'Institution'}
            action={staff && (user.role === 'officer' || user.role === 'admin' || user.role === 'regional') ? <button className="btn-ghost !py-1 text-xs" disabled={busy} onClick={() => void reevaluate()}>{busy ? 'Evaluating…' : '↻ Re-evaluate now'}</button> : undefined}>
            <ErrorNote message={err ?? detail.error} />
            {detail.loading && <Loading />}
            {detail.data && (
              <div className="grid gap-6 lg:grid-cols-2">
                <div>
                  <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">Compliance score, last {detail.data.trend.length} months</div>
                  <TrendChart data={detail.data.trend} xKey="period" yKey="score" name="Compliance score" />
                  <RegistryCheck institutionId={detail.data.institution.id} />
                  <p className="mt-1 text-xs text-muted">Approval valid until: {detail.data.institution.approval_valid_until ? fmtDate(detail.data.institution.approval_valid_until).split(',').slice(0, 2).join(',') : 'n/a'}</p>
                </div>
                <div>
                  <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">Latest rule results</div>
                  <ul className="divide-y divide-line text-sm">
                    {detail.data.results.map((r) => (
                      <li key={r.rule_code} className="flex items-center gap-3 py-2">
                        <Chip tone={r.passed ? (Number(r.score) >= 0.999 ? 'good' : 'warn') : 'bad'} icon={r.passed ? (Number(r.score) >= 0.999 ? '✓' : '!') : '✕'}>{r.passed ? 'Pass' : 'Fail'}</Chip>
                        <div><div className="font-medium">{r.name}</div><div className="text-xs text-ink2">{r.detail}</div></div>
                        <span className="ml-auto text-xs text-muted">{humanize(r.severity)}</span>
                      </li>
                    ))}
                  </ul>
                  {latestMetrics && (
                    <dl className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                      {[['Faculty', latestMetrics.faculty_count], ['Students', latestMetrics.student_count], ['Built-up sq m', latestMetrics.built_up_sqm], ['Labs', latestMetrics.lab_count]].map(([k, v]) => (
                        <div key={String(k)} className="rounded-xl bg-page p-2"><dt className="text-muted">{k}</dt><dd className="text-base font-semibold">{v}</dd></div>
                      ))}
                    </dl>
                  )}
                </div>
              </div>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
