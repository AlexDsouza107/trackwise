'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Card, Chip, ErrorNote, Loading, PageHeader } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { humanize } from '@/lib/format';

interface Rule { code: string; name: string; description: string; severity: 'critical' | 'major' | 'minor'; weight: number; params: Record<string, number> }
interface Config {
  stages: { stage: string; label: string }[];
  types: { type: string; label: string; stages: string[] }[];
  sla: { state: string; label: string; hours: number }[];
  rules: Rule[];
  integrations: { key: string; name: string; mode: 'mock' | 'stub'; description: string }[];
}

const PARAM_LABEL: Record<string, string> = {
  maxRatio: 'Max students per faculty', minSqmPerStudent: 'Min sq m per student', minLabs: 'Min labs', warnDays: 'Warn when days left <', maxAnnualFee: 'Fee cap (per year)',
};

/** Admin settings: stage routing per application type, SLA hours and compliance thresholds. Escalation rules live under Alerts. */
export default function Settings() {
  const { data, error, loading, reload } = useApi<Config>('/config');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [routes, setRoutes] = useState<Record<string, string[]>>({});
  const [sla, setSla] = useState<Record<string, string>>({});
  const [rules, setRules] = useState<Record<string, { weight: string; severity: string; params: Record<string, string> }>>({});

  useEffect(() => {
    if (!data) return;
    setRoutes(Object.fromEntries(data.types.map((t) => [t.type, t.stages])));
    setSla(Object.fromEntries(data.sla.map((s) => [s.state, String(s.hours)])));
    setRules(Object.fromEntries(data.rules.map((r) => [r.code, { weight: String(r.weight), severity: r.severity, params: Object.fromEntries(Object.entries(r.params).map(([k, v]) => [k, String(v)])) }])));
  }, [data]);

  async function run(key: string, fn: () => Promise<unknown>, done: string) {
    setBusy(key); setErr(null); setMsg(null);
    try { await fn(); setMsg(done); await reload(); } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }

  if (loading) return <Loading />;
  if (!data) return <ErrorNote message={error} />;

  const toggle = (type: string, stage: string) =>
    setRoutes((r) => ({ ...r, [type]: r[type].includes(stage) ? r[type].filter((s) => s !== stage) : [...r[type], stage] }));
  const order = data.stages.map((s) => s.stage);
  const label = (stage: string) => data.stages.find((s) => s.stage === stage)?.label ?? humanize(stage);

  return (
    <>
      <PageHeader title="Settings" subtitle="Workflow routing, time limits and compliance thresholds. Changes apply to new submissions and the next evaluation; in-flight applications keep the route they were submitted with." />
      <ErrorNote message={err} />
      {msg && <div role="status" className="mb-4 rounded-xl bg-good-soft px-3.5 py-2.5 text-sm text-good-text">✓ {msg}</div>}

      <div className="space-y-4">
        <Card title="Workflow routes" action={<span className="text-xs text-muted">Decision is always the last step</span>}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-line"><tr><th className="th">Application type</th>{data.stages.map((s) => <th key={s.stage} className="th text-center">{s.label}</th>)}<th className="th">Resulting path</th><th className="th" /></tr></thead>
              <tbody className="divide-y divide-line">
                {data.types.map((t) => {
                  const chosen = order.filter((s) => (routes[t.type] ?? []).includes(s));
                  const dirty = JSON.stringify(chosen) !== JSON.stringify(t.stages);
                  return (
                    <tr key={t.type}>
                      <td className="td font-medium">{t.label}</td>
                      {data.stages.map((s) => (
                        <td key={s.stage} className="td text-center">
                          <input type="checkbox" className="h-4 w-4 accent-[var(--brand)]" aria-label={`${t.label}: ${s.label}`} checked={chosen.includes(s.stage)} onChange={() => toggle(t.type, s.stage)} />
                        </td>
                      ))}
                      <td className="td text-xs text-ink2">{chosen.length ? ['Submitted', ...chosen.map(label), 'Decision'].join(' → ') : <span className="text-bad-text">Choose at least one stage</span>}</td>
                      <td className="td text-right"><button className="btn-primary !px-3 !py-1 text-xs" disabled={!dirty || !chosen.length || busy === `route-${t.type}`}
                        onClick={() => void run(`route-${t.type}`, () => api(`/config/routes/${t.type}`, { method: 'PUT', json: { stages: chosen } }), `${t.label} route saved.`)}>Save</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Stage time limits (SLA, hours)">
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {data.sla.map((s) => (
              <div key={s.state}>
                <label className="label" htmlFor={`sla-${s.state}`}>{s.label}</label>
                <div className="flex gap-1.5">
                  <input id={`sla-${s.state}`} type="number" min={1} className="input !px-2.5" value={sla[s.state] ?? ''} onChange={(e) => setSla((v) => ({ ...v, [s.state]: e.target.value }))} />
                  <button className="btn-ghost !px-2.5 text-xs" disabled={Number(sla[s.state]) === s.hours || !Number(sla[s.state]) || busy === `sla-${s.state}`}
                    onClick={() => void run(`sla-${s.state}`, () => api('/config/sla', { method: 'PUT', json: { state: s.state, hours: Number(sla[s.state]) } }), `${s.label} SLA saved.`)}>Save</button>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted">Escalation levels and e-mail rules for breaches are edited under <Link className="text-brand hover:underline" href="/alerts">Alerts → Escalation rules</Link>.</p>
        </Card>

        <Card title="Compliance rules" action={
          <button className="btn-ghost !py-1 text-xs" disabled={busy === 'reeval'} onClick={() => void run('reeval', async () => { const r = await api<{ evaluated: number }>('/config/rules/reevaluate', { method: 'POST' }); setMsg(`Re-evaluated ${r.evaluated} institutions.`); }, 'Re-evaluation complete.')}>↻ Re-evaluate all institutions</button>}>
          <div className="space-y-5">
            {data.rules.map((r) => {
              const v = rules[r.code];
              if (!v) return null;
              const dirty = Number(v.weight) !== r.weight || v.severity !== r.severity || Object.entries(v.params).some(([k, x]) => Number(x) !== r.params[k]);
              return (
                <div key={r.code} className="rounded-2xl bg-page p-4">
                  <div className="mb-2 flex flex-wrap items-center gap-2"><span className="font-medium">{r.name}</span><Chip tone={r.severity === 'critical' ? 'bad' : 'warn'} icon={r.severity === 'critical' ? '✕' : '!'}>{humanize(r.severity)}</Chip>
                    <span className="text-xs text-muted">{r.description}</span></div>
                  <div className="grid items-end gap-3 sm:grid-cols-5">
                    {Object.keys(r.params).map((k) => (
                      <div key={k}><label className="label" htmlFor={`${r.code}-${k}`}>{PARAM_LABEL[k] ?? humanize(k)}</label>
                        <input id={`${r.code}-${k}`} type="number" className="input" value={v.params[k]} onChange={(e) => setRules((x) => ({ ...x, [r.code]: { ...v, params: { ...v.params, [k]: e.target.value } } }))} /></div>
                    ))}
                    <div><label className="label" htmlFor={`${r.code}-w`}>Weight</label>
                      <input id={`${r.code}-w`} type="number" step="0.5" min="0.5" className="input" value={v.weight} onChange={(e) => setRules((x) => ({ ...x, [r.code]: { ...v, weight: e.target.value } }))} /></div>
                    <div><label className="label" htmlFor={`${r.code}-s`}>Severity</label>
                      <select id={`${r.code}-s`} className="input" value={v.severity} onChange={(e) => setRules((x) => ({ ...x, [r.code]: { ...v, severity: e.target.value } }))}><option value="critical">Critical (blocks clearance)</option><option value="major">Major</option><option value="minor">Minor</option></select></div>
                    <button className="btn-primary" disabled={!dirty || busy === `rule-${r.code}`} onClick={() => void run(`rule-${r.code}`, () => api(`/config/rules/${r.code}`, {
                      method: 'PUT', json: { weight: Number(v.weight), severity: v.severity, params: Object.fromEntries(Object.entries(v.params).map(([k, x]) => [k, Number(x)])) } }), `${r.name} saved. Re-evaluate to apply it to existing results.`)}>Save</button>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <Card title="Integrations">
          <ul className="divide-y divide-line text-sm">
            {data.integrations.map((i) => (
              <li key={i.key} className="flex flex-wrap items-center gap-3 py-2.5">
                <Chip tone="warn" icon="◌">{i.mode === 'mock' ? 'Mock adapter' : 'Stub'}</Chip>
                <span className="font-medium">{i.name}</span><span className="text-xs text-ink2">{i.description}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted">Each adapter sits behind a small interface in <code>api/src/integrations</code>; swapping in a real client does not change the workflow.</p>
        </Card>
      </div>
    </>
  );
}
