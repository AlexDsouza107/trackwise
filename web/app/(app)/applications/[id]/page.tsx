'use client';
import { useParams } from 'next/navigation';
import { useRef, useState } from 'react';
import DocViewer from '@/components/DocViewer';
import { Card, Chip, ErrorNote, Loading, PageHeader, RiskChip, SlaChip, StateBadge } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { useUser } from '@/lib/auth';
import { fmtBytes, fmtDate, humanize, STAGES, STATE_LABEL } from '@/lib/format';
import type { ApplicationDetail, AppState } from '@/lib/types';

function Stepper({ state, rounds }: { state: AppState; rounds: number }) {
  const idx = STAGES.indexOf(state === 'rejected' ? 'decision' : state);
  return (
    <ol className="flex flex-wrap gap-1.5 text-xs" aria-label="Workflow progress">
      {STAGES.map((s, i) => {
        const done = state === 'approved' ? true : i < idx;
        const cur = i === idx && state !== 'approved';
        return (
          <li key={s} className={`rounded-full px-3 py-1 ${cur ? 'bg-brand-soft font-medium text-brand' : done ? 'bg-good-soft text-good-text' : 'bg-page text-muted'}`}>
            {done ? '✓ ' : ''}{STATE_LABEL[s]}
          </li>
        );
      })}
      {state === 'deficiency' && <li className="rounded-full bg-warn-soft px-3 py-1 font-medium text-warn-text">! Deficiency (round {rounds})</li>}
      {state === 'rejected' && <li className="rounded-full bg-bad-soft px-3 py-1 font-medium text-bad-text">✕ Rejected</li>}
    </ol>
  );
}

export default function ApplicationPage() {
  const { id } = useParams<{ id: string }>();
  const user = useUser();
  const { data: app, error, reload, setData } = useApi<ApplicationDetail>(`/applications/${id}`, 20000);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [viewId, setViewId] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadType, setUploadType] = useState<string | null>(null);

  if (error && !app) return <ErrorNote message={error} />;
  if (!app) return <Loading />;

  const isInst = user.role === 'institution';
  const hoursLeft = app.sla_due_at ? (new Date(app.sla_due_at).getTime() - Date.now()) / 3_600_000 : null;
  const canUpload = isInst && (app.state === 'draft' || app.state === 'deficiency');
  const docByType = (t: string) => app.documents.filter((d) => d.doc_type === t).at(-1);
  const viewDoc = app.documents.find((d) => d.id === viewId) ?? null;
  const lastDeficiency = [...app.audit].reverse().find((a) => a.event === 'RAISE_DEFICIENCY');
  const needsNote = app.availableActions.some((a) => a.requiresNote);

  async function act(key: string) {
    setBusy(key); setActionError(null);
    try {
      setData(await api<ApplicationDetail>(`/applications/${id}/actions`, { method: 'POST', json: { action: key, note: note || undefined } }));
      setNote('');
    } catch (e) { setActionError((e as Error).message); } finally { setBusy(null); }
  }

  async function upload(file: File, docType: string) {
    setBusy(`upload-${docType}`); setActionError(null);
    try {
      const form = new FormData();
      form.append('docType', docType);
      form.append('file', file);
      await api(`/applications/${id}/documents`, { method: 'POST', body: form });
      await reload();
    } catch (e) { setActionError((e as Error).message); } finally { setBusy(null); if (fileRef.current) fileRef.current.value = ''; }
  }

  async function remove(docId: number) {
    setBusy(`remove-${docId}`); setActionError(null);
    try {
      await api(`/applications/${id}/documents/${docId}`, { method: 'DELETE' });
      if (viewId === docId) setViewId(null);
      await reload();
    } catch (e) { setActionError((e as Error).message); } finally { setBusy(null); }
  }

  return (
    <>
      <PageHeader
        title={app.title}
        subtitle={`${app.reference} · ${app.typeLabel} · ${app.institution.name}, ${app.institution.city}`}
        action={<div className="flex items-center gap-2"><SlaChip hoursLeft={hoursLeft} /><StateBadge state={app.state} /></div>}
      />
      <div className="mb-4"><Stepper state={app.state} rounds={app.context.deficiencyRounds} /></div>

      {isInst && app.state === 'deficiency' && lastDeficiency && (
        <div className="mb-5 rounded-[22px] bg-warn-soft p-5 text-sm text-warn-text">
          <div className="font-semibold">! Deficiency raised by {lastDeficiency.actor_name}</div>
          <p className="mt-1">{lastDeficiency.note}</p>
          <p className="mt-1 text-xs">Upload the missing or corrected documents below, add a note, and resubmit.</p>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Documents" action={app.doc_check && <Chip tone={app.doc_check.missing.length ? 'warn' : 'good'} icon={app.doc_check.missing.length ? '!' : '✓'}>{app.doc_check.completeness_pct}% complete</Chip>}>
            <input ref={fileRef} type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx"
              onChange={(e) => { const f = e.target.files?.[0]; if (f && uploadType) void upload(f, uploadType); }} />
            <ul className="divide-y divide-line">
              {app.requiredDocuments.map((t) => {
                const d = docByType(t);
                return (
                  <li key={t} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                    <span className={`w-5 text-center ${d ? 'text-good-text' : 'text-muted'}`} aria-label={d ? 'uploaded' : 'missing'}>{d ? '✓' : '○'}</span>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{humanize(t)}</div>
                      <div className="truncate text-xs text-muted">{d ? `${d.filename} · ${fmtBytes(d.size_bytes)} · ${fmtDate(d.uploaded_at)}` : 'Not uploaded'}</div>
                    </div>
                    {d && <button className="btn-ghost !px-2.5 !py-1 text-xs" onClick={() => setViewId(d.id)}>View</button>}
                    {canUpload && d && (
                      <button className="grid h-7 w-7 place-items-center rounded-full text-muted transition hover:bg-bad-soft hover:text-bad-text" aria-label={`Remove ${humanize(t)}`} title="Remove"
                        disabled={busy === `remove-${d.id}`} onClick={() => void remove(d.id)}>✕</button>
                    )}
                    {canUpload && !d && <button className="btn-ghost !px-2.5 !py-1 text-xs" disabled={busy === `upload-${t}`}
                      onClick={() => { setUploadType(t); setTimeout(() => fileRef.current?.click(), 0); }}>＋ Add</button>}
                  </li>
                );
              })}
            </ul>
            <div className="mt-4"><DocViewer appId={app.id} doc={viewDoc} /></div>
          </Card>

          <Card title="Application details">
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              {Object.entries(app.details).map(([k, v]) => (
                <div key={k}><dt className="text-xs text-muted">{humanize(k.replace(/([A-Z])/g, ' $1').toLowerCase())}</dt><dd className="font-medium">{String(v)}</dd></div>
              ))}
            </dl>
          </Card>

          {!isInst && (
            <>
              <Card title="AI assessment" action={<RiskChip level={app.risk_level} score={app.risk_score} />}>
                {!app.risk_factors && <p className="text-sm text-muted">AI service was unavailable when this application was last evaluated.</p>}
                {app.risk_factors && (
                  <ul className="space-y-2 text-sm">
                    {app.risk_factors.factors.map((f) => (
                      <li key={f.feature + f.label} className="flex items-start gap-3">
                        <span className={`w-12 shrink-0 text-right font-mono text-xs ${f.points < 0 ? 'text-good-text' : ''}`}>{f.points > 0 ? '+' : ''}{f.points}</span>
                        <div><div className="font-medium">{f.label}</div><div className="text-xs text-ink2">{f.detail}</div></div>
                      </li>
                    ))}
                  </ul>
                )}
                {app.risk_factors && <p className="mt-3 text-xs text-muted">Rules-based additive model ({app.risk_factors.modelVersion}). Each factor shows the points it added, so the score is fully explainable.</p>}
                {app.doc_check && app.doc_check.findings.length > 0 && (
                  <div className="mt-4 border-t border-line pt-3">
                    <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Document check findings</div>
                    <ul className="space-y-1.5 text-sm">
                      {app.doc_check.findings.map((f, i) => (
                        <li key={i} className="flex gap-2"><Chip tone={f.severity === 'critical' ? 'bad' : f.severity === 'warning' ? 'warn' : 'neutral'} icon={f.severity === 'critical' ? '✕' : f.severity === 'warning' ? '!' : 'i'}>{f.severity}</Chip><span>{f.message}</span></li>
                      ))}
                    </ul>
                  </div>
                )}
              </Card>

              <Card title="Compliance evaluation" action={app.compliance && <Chip tone={app.compliance.criticalFailures ? 'bad' : app.compliance.score >= 80 ? 'good' : 'warn'} icon={app.compliance.criticalFailures ? '✕' : '✓'}>Score {Math.round(app.compliance.score)}/100</Chip>}>
                {!app.compliance && <p className="text-sm text-muted">No institution metrics on record.</p>}
                {app.compliance && (
                  <>
                    <ul className="divide-y divide-line text-sm">
                      {app.compliance.outcomes.map((o) => (
                        <li key={o.ruleCode} className="flex items-center gap-3 py-2">
                          <Chip tone={o.passed ? 'good' : 'bad'} icon={o.passed ? '✓' : '✕'}>{o.passed ? 'Pass' : 'Fail'}</Chip>
                          <span className="font-medium">{humanize(o.ruleCode)}</span><span className="ml-auto text-xs text-ink2">{o.detail}</span>
                        </li>
                      ))}
                    </ul>
                    {app.compliance.note && <p className="mt-2 text-xs text-muted">{app.compliance.note}</p>}
                    {app.compliance.criticalFailures > 0 && <p className="mt-2 text-sm text-bad-text">✕ {app.compliance.criticalFailures} critical failure(s) block clearance. Raise a deficiency.</p>}
                  </>
                )}
              </Card>
            </>
          )}
        </div>

        <div className="space-y-4">
          <Card title="Actions">
            {app.availableActions.length === 0 && <p className="text-sm text-muted">No actions available to you in this stage.{app.state !== 'approved' && app.state !== 'rejected' && !isInst ? ' It sits with another role.' : ''}</p>}
            {app.availableActions.length > 0 && (
              <div className="space-y-3">
                {needsNote && (
                  <div><label className="label" htmlFor="note">Note (required for some actions)</label>
                    <textarea id="note" className="input min-h-20" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason, observations, or what was corrected…" /></div>
                )}
                <ErrorNote message={actionError} />
                <div className="flex flex-col gap-2">
                  {app.availableActions.map((a) => (
                    <button key={a.key} disabled={!!busy || (a.requiresNote && !note.trim())}
                      className={a.tone === 'danger' ? 'btn-danger' : a.tone === 'warning' ? 'btn-warning' : 'btn-primary'} onClick={() => void act(a.key)}>
                      {busy === a.key ? 'Working…' : a.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {actionError && app.availableActions.length === 0 && <ErrorNote message={actionError} />}
            {app.context.recommendation && <p className="mt-3 text-xs text-ink2">Committee recommendation: <b>{app.context.recommendation}</b></p>}
          </Card>

          <Card title="Audit trail">
            <ol className="relative space-y-4 border-l border-line pl-4">
              {[...app.audit].reverse().map((a) => (
                <li key={a.id} className="text-sm">
                  <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-brand" aria-hidden />
                  <div className="font-medium">{humanize(a.event)}{a.from_state && a.to_state && a.from_state !== a.to_state ? <span className="font-normal text-ink2"> · {STATE_LABEL[a.from_state as AppState] ?? a.from_state} → {STATE_LABEL[a.to_state as AppState] ?? a.to_state}</span> : null}</div>
                  <div className="text-xs text-muted">{a.actor_name} ({a.actor_role}) · {fmtDate(a.created_at)}</div>
                  {a.note && <div className="mt-0.5 text-xs text-ink2">“{a.note}”</div>}
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
}
