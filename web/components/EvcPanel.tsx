'use client';
import { useState } from 'react';
import { Card, Chip, ErrorNote } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import type { EvcVisit, Role } from '@/lib/types';

const OUTCOME = { satisfactory: ['good', '✓', 'Satisfactory'], minor_gaps: ['warn', '!', 'Minor gaps'], major_gaps: ['bad', '✕', 'Major gaps'] } as const;

/** Expert Visit Committee: shows the visit and offers scheduling and the visit report to the roles allowed to do each. */
export default function EvcPanel({ appId, visit, user, active, onChange }: {
  appId: number; visit: EvcVisit; user: { id: number; role: Role }; active: boolean; onChange: () => Promise<void> | void;
}) {
  const canSchedule = active && (user.role === 'regional' || user.role === 'admin') && visit.status !== 'completed';
  const canReport = active && visit.status === 'scheduled'
    && (user.role === 'admin' || user.role === 'regional' || (user.role === 'committee' && visit.member_ids.includes(user.id)));
  const members = useApi<{ id: number; name: string }[]>(canSchedule ? '/evc/members' : null);
  const [when, setWhen] = useState('');
  const [venue, setVenue] = useState('Institute campus');
  const [picked, setPicked] = useState<number[]>([]);
  const [outcome, setOutcome] = useState<keyof typeof OUTCOME>('satisfactory');
  const [findings, setFindings] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(path: string, json: unknown) {
    setBusy(true); setErr(null);
    try { await api(`/applications/${appId}/evc/${path}`, { method: 'POST', json }); await onChange(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  const status = visit.status === 'completed' ? ['good', '✓', 'Report filed'] as const
    : visit.status === 'scheduled' ? ['brand', '●', 'Scheduled'] as const : ['warn', '!', 'Awaiting schedule'] as const;

  return (
    <Card title={`Expert visit (EVC)${visit.round > 1 ? ` · round ${visit.round}` : ''}`} action={<Chip tone={status[0]} icon={status[1]}>{status[2]}</Chip>}>
      <ErrorNote message={err} />
      {visit.status !== 'awaiting_schedule' && (
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div><dt className="text-xs text-muted">Visit date</dt><dd className="font-medium">{fmtDate(visit.scheduled_for)}</dd></div>
          <div><dt className="text-xs text-muted">Venue</dt><dd className="font-medium">{visit.venue}</dd></div>
          <div className="sm:col-span-2"><dt className="text-xs text-muted">Visit members</dt><dd className="font-medium">{visit.members.map((m) => m.name).join(', ')}</dd></div>
          <div className="sm:col-span-2 text-xs text-muted">Scheduled by {visit.scheduled_by_name}. Reminders go to the institution (72h before) and the members (24h before); an unfiled report escalates after the visit date.</div>
        </dl>
      )}
      {visit.status === 'awaiting_schedule' && !canSchedule && <p className="text-sm text-muted">The regional officer has not scheduled the visit yet. Unscheduled visits escalate automatically.</p>}

      {canSchedule && (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void submit('schedule', { scheduledFor: new Date(when).toISOString(), venue, memberIds: picked }); }}>
          <div className="text-sm font-medium">{visit.status === 'scheduled' ? 'Reschedule the visit' : 'Schedule the visit'}</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className="label" htmlFor="evc-when">Date and time</label><input id="evc-when" type="datetime-local" required className="input" value={when} onChange={(e) => setWhen(e.target.value)} /></div>
            <div><label className="label" htmlFor="evc-venue">Venue</label><input id="evc-venue" required minLength={2} className="input" value={venue} onChange={(e) => setVenue(e.target.value)} /></div>
          </div>
          <fieldset><legend className="label">Visit members (committee)</legend>
            <div className="flex flex-wrap gap-2">
              {members.data?.map((m) => (
                <label key={m.id} className={`cursor-pointer rounded-full px-3 py-1 text-xs ${picked.includes(m.id) ? 'bg-brand-soft font-medium text-brand' : 'bg-page text-ink2'}`}>
                  <input type="checkbox" className="sr-only" checked={picked.includes(m.id)} onChange={() => setPicked((p) => (p.includes(m.id) ? p.filter((x) => x !== m.id) : [...p, m.id]))} />
                  {picked.includes(m.id) ? '✓ ' : ''}{m.name}
                </label>
              ))}
            </div>
          </fieldset>
          <button className="btn-primary" disabled={busy || !when || !picked.length}>{busy ? 'Saving…' : visit.status === 'scheduled' ? 'Reschedule' : 'Schedule visit'}</button>
        </form>
      )}

      {canReport && (
        <form className="mt-5 space-y-3 border-t border-line pt-4" onSubmit={(e) => { e.preventDefault(); void submit('report', { outcome, findings }); }}>
          <div className="text-sm font-medium">Record the visit report</div>
          <div className="seg" role="radiogroup" aria-label="Outcome">
            {(Object.keys(OUTCOME) as (keyof typeof OUTCOME)[]).map((o) => (
              <button type="button" key={o} role="radio" aria-checked={outcome === o} aria-pressed={outcome === o} className="seg-item" onClick={() => setOutcome(o)}>{OUTCOME[o][1]} {OUTCOME[o][2]}</button>
            ))}
          </div>
          <div><label className="label" htmlFor="evc-findings">Findings</label>
            <textarea id="evc-findings" required minLength={10} className="input min-h-20" value={findings} onChange={(e) => setFindings(e.target.value)} placeholder="What was inspected and what was found…" /></div>
          <button className="btn-primary" disabled={busy || findings.trim().length < 10}>{busy ? 'Saving…' : 'File report'}</button>
        </form>
      )}

      {visit.report && (
        <div className="mt-4 rounded-2xl bg-page p-4 text-sm">
          <div className="mb-1 flex items-center gap-2"><Chip tone={OUTCOME[visit.report.outcome][0]} icon={OUTCOME[visit.report.outcome][1]}>{OUTCOME[visit.report.outcome][2]}</Chip>
            <span className="text-xs text-muted">{visit.report.filedBy} · {fmtDate(visit.report.filedAt)}</span></div>
          <p>{visit.report.findings}</p>
        </div>
      )}
    </Card>
  );
}
