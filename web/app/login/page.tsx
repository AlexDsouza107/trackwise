'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, storeSession } from '@/lib/api';
import { ErrorNote } from '@/components/ui';
import { useApi } from '@/lib/api';
import type { Role, User } from '@/lib/types';

interface Demo { email: string; name: string; role: Role; institution: string | null }
const ROLE_LABEL: Record<Role, string> = { admin: 'Administrator', officer: 'Scrutiny officers', committee: 'Committee members', institution: 'Institutions' };

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const demo = useApi<Demo[]>('/auth/demo-accounts');

  async function signIn(e: string, p: string) {
    setBusy(true); setError(null);
    try {
      const r = await api<{ token: string; user: User }>('/auth/login', { method: 'POST', json: { email: e, password: p } });
      storeSession(r.token, r.user);
      router.replace('/applications');
    } catch (err) { setError((err as Error).message); setBusy(false); }
  }

  const groups = (['admin', 'officer', 'committee', 'institution'] as Role[]).map((r) => [r, (demo.data ?? []).filter((d) => d.role === r)] as const);

  const initials = (n: string) => n.replace(/\(.*\)/, '').replace(/^(Dr\.|Prof\.|Registrar,)\s*/, '').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const FEATURES = ['Workflow automation', 'Compliance monitoring', 'Smart alerts', 'AI risk scoring'];

  return (
    <div className="mx-auto grid min-h-screen max-w-6xl items-center gap-10 px-6 py-10 lg:grid-cols-[1.05fr_1fr]">
      <div className="rise">
        <div className="mb-6 flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-[15px] bg-brand text-[17px] font-semibold text-brand-ink shadow-[0_10px_30px_-8px_var(--brand)]">TW</span>
          <span className="text-[34px] font-semibold tracking-[-0.025em]">TrackWise</span>
        </div>
        <h1 className="max-w-md text-[40px] font-semibold leading-[1.08] tracking-[-0.03em]">Approvals, compliance and alerts, in one calm place.</h1>
        <p className="mt-3 max-w-md text-[16px] text-ink2">Integrated approval workflow automation, compliance monitoring and alert management.</p>
        <div className="mt-5 flex max-w-md flex-wrap gap-2">
          {FEATURES.map((f) => <span key={f} className="glass rounded-full px-3 py-1 text-[12px] text-ink2">{f}</span>)}
        </div>
        <form className="card mt-8 max-w-md space-y-4 p-6" onSubmit={(e) => { e.preventDefault(); void signIn(email, password); }}>
          <div><label className="label" htmlFor="email">Email</label><input id="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" /></div>
          <div><label className="label" htmlFor="pw">Password</label><input id="pw" type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></div>
          <ErrorNote message={error} />
          <button className="btn-primary w-full !py-2.5" disabled={busy}>Sign in</button>
        </form>
        <p className="mt-3 max-w-md text-[12px] text-muted">Demo password for every account: <code>demo1234</code>. All data is illustrative.</p>
      </div>
      <div className="card p-5" style={{ animationDelay: '120ms' }}>
        <h2 className="mb-3 px-1 text-[15px] font-semibold tracking-tight">One-click demo accounts</h2>
        {demo.loading && <div className="space-y-2"><div className="skeleton h-14" /><div className="skeleton h-14" /><div className="skeleton h-14" /></div>}
        {demo.error && <ErrorNote message={`Cannot reach the API (${demo.error}). Is it running?`} />}
        <div className="max-h-[30rem] space-y-4 overflow-auto pr-1">
          {groups.map(([role, list]) => list.length > 0 && (
            <div key={role}>
              <div className="mb-1.5 px-1 text-[11px] font-medium uppercase tracking-[0.07em] text-muted">{ROLE_LABEL[role]}</div>
              <div className="grid gap-1.5">
                {list.map((d) => (
                  <button key={d.email} disabled={busy} onClick={() => void signIn(d.email, 'demo1234')}
                    className="lift flex items-center gap-3 rounded-2xl bg-page px-3 py-2.5 text-left transition hover:brightness-95 disabled:opacity-60">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-soft text-[12px] font-semibold text-brand">{initials(d.name)}</span>
                    <span className="min-w-0"><span className="block truncate text-[14px] font-medium">{d.name}</span>
                      <span className="block truncate text-[12px] text-muted">{d.email}{d.institution ? ` · ${d.institution}` : ''}</span></span>
                    <span className="ml-auto text-muted" aria-hidden>›</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
