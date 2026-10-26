'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Card, ErrorNote, Loading, PageHeader } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { TYPE_FIELDS } from '@/lib/forms';

interface Meta { types: { type: string; label: string; requiredDocuments: string[] }[] }

export default function NewApplication() {
  const router = useRouter();
  const meta = useApi<Meta>('/meta');
  const [type, setType] = useState<string>('new_course');
  const [title, setTitle] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!meta.data) return <Loading />;
  const current = meta.data.types.find((t) => t.type === type)!;

  async function create() {
    setBusy(true); setError(null);
    const details: Record<string, string | number> = {};
    for (const f of TYPE_FIELDS[type]) {
      const v = values[f.name];
      if (v === undefined || v === '') { if (!f.optional) { setError(`Please fill in "${f.label}"`); setBusy(false); return; } continue; }
      details[f.name] = f.type === 'number' ? Number(v) : v;
    }
    try {
      const app = await api<{ id: number }>('/applications', { method: 'POST', json: { type, title, details } });
      router.push(`/applications/${app.id}`);
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }

  return (
    <>
      <PageHeader title="New application" subtitle="Create a draft, upload the required documents, then submit for scrutiny." />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="1. Application type" className="lg:col-span-1">
          <div className="space-y-2">
            {meta.data.types.map((t) => (
              <label key={t.type} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${type === t.type ? 'border-brand bg-brand-soft' : 'border-line'}`}>
                <input type="radio" name="type" checked={type === t.type} onChange={() => { setType(t.type); setValues({}); }} />
                {t.label}
              </label>
            ))}
          </div>
          <div className="mt-4 text-xs text-ink2">
            <div className="mb-1 font-medium">Documents you will need</div>
            <ul className="list-inside list-disc space-y-0.5">{current.requiredDocuments.map((d) => <li key={d}>{d.replace(/_/g, ' ')}</li>)}</ul>
          </div>
        </Card>
        <Card title="2. Details" className="lg:col-span-2">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2"><label className="label" htmlFor="title">Title</label>
              <input id="title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. B.Tech AI & ML new course" /></div>
            {TYPE_FIELDS[type].map((f) => (
              <div key={f.name} className={f.type === 'textarea' ? 'sm:col-span-2' : ''}>
                <label className="label" htmlFor={f.name}>{f.label}{f.optional ? ' (optional)' : ''}</label>
                {f.type === 'textarea' ? (
                  <textarea id={f.name} className="input min-h-20" value={values[f.name] ?? ''} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })} />
                ) : f.type === 'select' ? (
                  <select id={f.name} className="input" value={values[f.name] ?? ''} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}>
                    <option value="">Select…</option>{f.options!.map((o) => <option key={o}>{o}</option>)}
                  </select>
                ) : (
                  <input id={f.name} className="input" type={f.type} min={f.type === 'number' ? 0 : undefined} placeholder={f.hint}
                    value={values[f.name] ?? ''} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })} />
                )}
              </div>
            ))}
          </div>
          <div className="mt-4 space-y-3">
            <ErrorNote message={error} />
            <button className="btn-primary" disabled={busy || title.trim().length < 3} onClick={() => void create()}>Create draft &amp; add documents →</button>
          </div>
        </Card>
      </div>
    </>
  );
}
