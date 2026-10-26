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

  return (
    <div className="mx-auto grid min-h-screen max-w-5xl items-center gap-8 p-6 md:grid-cols-2">
      <div>
        <div className="mb-4 flex items-center gap-2">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand text-base font-bold text-brand-ink">TW</span>
          <span className="text-2xl font-semibold">TrackWise</span>
        </div>
        <p className="mb-6 text-ink2">Integrated approval workflow automation, compliance monitoring and alert management.</p>
        <form className="card space-y-3 p-5" onSubmit={(e) => { e.preventDefault(); void signIn(email, password); }}>
          <div><label className="label" htmlFor="email">Email</label><input id="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" /></div>
          <div><label className="label" htmlFor="pw">Password</label><input id="pw" type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></div>
          <ErrorNote message={error} />
          <button className="btn-primary w-full" disabled={busy}>Sign in</button>
        </form>
        <p className="mt-3 text-xs text-muted">Demo password for every account: <code>demo1234</code>. All data is illustrative.</p>
      </div>
      <div className="card p-5">
        <h2 className="mb-3 text-sm font-semibold">One-click demo accounts</h2>
        {demo.loading && <p className="text-sm text-muted">Loading accounts…</p>}
        {demo.error && <ErrorNote message={`Cannot reach the API (${demo.error}). Is it running?`} />}
        <div className="max-h-[28rem] space-y-4 overflow-auto">
          {groups.map(([role, list]) => list.length > 0 && (
            <div key={role}>
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">{ROLE_LABEL[role]}</div>
              <div className="grid gap-1">
                {list.map((d) => (
                  <button key={d.email} disabled={busy} onClick={() => void signIn(d.email, 'demo1234')}
                    className="rounded-lg border border-line px-3 py-2 text-left text-sm hover:bg-page">
                    <div className="font-medium">{d.name}</div>
                    <div className="text-xs text-muted">{d.email}{d.institution ? ` · ${d.institution}` : ''}</div>
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
