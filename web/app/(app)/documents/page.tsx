'use client';
import { useRef, useState } from 'react';
import { Card, Chip, Empty, ErrorNote, Loading, PageHeader } from '@/components/ui';
import { api, fetchBlobUrl, useApi } from '@/lib/api';
import { useUser } from '@/lib/auth';
import { fmtDate, REGIONS, STATUS_LABEL } from '@/lib/format';
import type { ValidityDoc } from '@/lib/types';

const TONE = { valid: ['good', '✓'], expiring: ['warn', '!'], expired: ['bad', '✕'], renewal_pending: ['brand', '↻'] } as const;
const FILTERS = [['', 'All'], ['expired', 'Expired'], ['expiring', 'Expiring soon'], ['renewal_pending', 'Renewal pending'], ['valid', 'Valid']] as const;

/** Register of lease and other prescribed documents: expiry tracking, renewal submission and renewal verification. */
export default function DocumentsPage() {
  const user = useUser();
  const inst = user.role === 'institution';
  const verifier = user.role === 'officer' || user.role === 'regional' || user.role === 'admin';
  const pinned = user.role === 'regional';
  const [status, setStatus] = useState('');
  const [region, setRegion] = useState('');
  const { data, error, loading, reload } = useApi<ValidityDoc[]>(`/validity?${status ? `status=${status}&` : ''}${region && !pinned ? `region=${region}` : ''}`, 30000);
  const kinds = useApi<{ kinds: { kind: string; label: string }[]; expiringSoonDays: number }>(inst ? '/validity/kinds' : null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [renewing, setRenewing] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [until, setUntil] = useState('');
  const [reference, setReference] = useState('');
  const [kind, setKind] = useState('');
  const [reason, setReason] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  async function send(path: string, fields: Record<string, string>) {
    const file = fileRef.current?.files?.[0];
    if (!file) { setErr('Choose the document file first.'); return; }
    setBusy(path); setErr(null);
    try {
      const form = new FormData();
      for (const [k, v] of Object.entries(fields)) if (v) form.append(k, v);
      form.append('file', file);
      await api(path, { method: 'POST', body: form });
      setRenewing(null); setAdding(false); setUntil(''); setReference(''); setKind('');
      await reload();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }

  async function verify(id: number, decision: 'approve' | 'reject') {
    setBusy(`verify-${id}`); setErr(null);
    try { await api(`/validity/${id}/verify`, { method: 'POST', json: { decision, note: reason || undefined } }); setReason(''); await reload(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }

  async function view(id: number, which: 'current' | 'renewal') {
    try { window.open(await fetchBlobUrl(`/validity/${id}/file?which=${which}`), '_blank', 'noopener'); } catch (e) { setErr((e as Error).message); }
  }

  const registered = new Set((data ?? []).map((d) => d.kind));
  const addable = (kinds.data?.kinds ?? []).filter((k) => !registered.has(k.kind));

  return (
    <>
      <PageHeader title="Document validity" subtitle="Lease deeds and other prescribed documents with expiry tracking, advance alerts (90 / 30 / 7 days and on expiry) and renewal verification."
        action={
          <div className="flex flex-wrap items-center gap-2">
            {!inst && (pinned ? <span className="rounded-full bg-brand-soft px-3 py-1 text-[13px] font-medium text-brand">{user.region} region</span> : (
              <select className="input !w-auto !py-1.5 text-[14px]" aria-label="Region" value={region} onChange={(e) => setRegion(e.target.value)}>
                <option value="">All regions</option>{REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>))}
            <div className="seg" role="tablist">
              {FILTERS.map(([k, label]) => <button key={k} role="tab" aria-selected={status === k} className="seg-item" onClick={() => setStatus(k)}>{label}</button>)}
            </div>
          </div>} />
      <input ref={fileRef} type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg" onChange={() => setErr(null)} />
      <ErrorNote message={error ?? err} />
      {loading && <Loading />}

      {inst && addable.length > 0 && (
        <Card title="Register a document" className="mb-4">
          {!adding ? <button className="btn-ghost" onClick={() => setAdding(true)}>＋ Register {addable.map((k) => k.label.toLowerCase()).join(', ')}</button> : (
            <form className="grid gap-3 sm:grid-cols-4" onSubmit={(e) => { e.preventDefault(); void send('/validity', { kind, validUntil: until, reference }); }}>
              <div><label className="label" htmlFor="v-kind">Document</label>
                <select id="v-kind" required className="input" value={kind} onChange={(e) => setKind(e.target.value)}><option value="">Choose…</option>{addable.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}</select></div>
              <div><label className="label" htmlFor="v-ref">Reference no.</label><input id="v-ref" className="input" value={reference} onChange={(e) => setReference(e.target.value)} /></div>
              <div><label className="label" htmlFor="v-until">Valid until</label><input id="v-until" type="date" required className="input" value={until} onChange={(e) => setUntil(e.target.value)} /></div>
              <div className="flex items-end gap-2"><button type="button" className="btn-ghost" onClick={() => fileRef.current?.click()}>Choose file</button>
                <button className="btn-primary" disabled={busy === '/validity' || !kind || !until}>Register</button></div>
            </form>)}
        </Card>
      )}

      {data && data.length === 0 && <Empty>No documents match.</Empty>}
      {data && data.length > 0 && (
        <Card className="overflow-hidden !p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px]">
              <thead className="border-b border-line"><tr>
                {!inst && <th className="th">Institution</th>}<th className="th">Document</th><th className="th">Valid until</th><th className="th">Status</th><th className="th text-right">Actions</th>
              </tr></thead>
              <tbody className="divide-y divide-line">
                {data.map((d) => (
                  <tr key={d.id} className="align-top">
                    {!inst && <td className="td"><div className="font-medium">{d.institution_name}</div><div className="text-xs text-muted">{d.region}</div></td>}
                    <td className="td"><div className="font-medium">{d.kind_label}</div><div className="text-xs text-muted">{d.reference ?? '-'} · {d.filename}</div>
                      {d.renewal && <div className="mt-1 text-xs text-ink2">Renewal submitted by {d.renewal.submittedBy} ({fmtDate(d.renewal.submittedAt)}) valid to {d.renewal.validUntil}{d.renewal.note ? ` · “${d.renewal.note}”` : ''}</div>}
                      {d.verified_at && <div className="mt-1 text-xs text-muted">Renewal verified by {d.verified_by_name} on {fmtDate(d.verified_at)}</div>}</td>
                    <td className="td text-sm">{d.valid_until}<div className="text-xs text-muted">{d.days_left < 0 ? `${-d.days_left}d ago` : `${d.days_left}d left`}</div></td>
                    <td className="td"><Chip tone={TONE[d.status][0]} icon={TONE[d.status][1]}>{STATUS_LABEL[d.status]}</Chip></td>
                    <td className="td text-right">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <button className="btn-ghost !px-2.5 !py-1 text-xs" onClick={() => void view(d.id, 'current')}>View</button>
                        {d.renewal && verifier && <button className="btn-ghost !px-2.5 !py-1 text-xs" onClick={() => void view(d.id, 'renewal')}>View renewal</button>}
                        {inst && !d.renewal && d.days_left <= 90 && <button className="btn-primary !px-2.5 !py-1 text-xs" onClick={() => { setRenewing(renewing === d.id ? null : d.id); setErr(null); }}>Renew</button>}
                      </div>
                      {renewing === d.id && (
                        <form className="mt-2 space-y-2 text-left" onSubmit={(e) => { e.preventDefault(); void send(`/validity/${d.id}/renew`, { validUntil: until, reference }); }}>
                          <input type="date" required aria-label="New valid until" className="input !py-1.5 text-xs" value={until} onChange={(e) => setUntil(e.target.value)} />
                          <div className="flex gap-2"><button type="button" className="btn-ghost !px-2.5 !py-1 text-xs" onClick={() => fileRef.current?.click()}>Choose file</button>
                            <button className="btn-primary !px-2.5 !py-1 text-xs" disabled={!until || busy === `/validity/${d.id}/renew`}>Submit renewal</button></div>
                        </form>)}
                      {d.renewal && verifier && (
                        <div className="mt-2 space-y-2 text-left">
                          <input className="input !py-1.5 text-xs" aria-label="Verification note" placeholder="Note (required to reject)" value={reason} onChange={(e) => setReason(e.target.value)} />
                          <div className="flex gap-2"><button className="btn-primary !px-2.5 !py-1 text-xs" disabled={busy === `verify-${d.id}`} onClick={() => void verify(d.id, 'approve')}>✓ Verify</button>
                            <button className="btn-danger !px-2.5 !py-1 text-xs" disabled={busy === `verify-${d.id}` || !reason.trim()} onClick={() => void verify(d.id, 'reject')}>✕ Reject</button></div>
                        </div>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
