'use client';
import { LogoMark, Wordmark } from '@/components/Brand';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, storeSession } from '@/lib/api';
import { ErrorNote } from '@/components/ui';
import { useApi } from '@/lib/api';
import type { Role, User } from '@/lib/types';

interface Demo { email: string; name: string; role: Role; institution: string | null }
const ROLE_LABEL: Record<Role, string> = { admin: 'Administrator', officer: 'Scrutiny officers', regional: 'Regional officers', committee: 'Committee members', institution: 'Institutions' };

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const demo = useApi<Demo[]>('/auth/demo-accounts');
  const [welcome, setWelcome] = useState<User | null>(null);

  // The welcome overlay locks scrolling; the body outlives this page on client navigation, so always release it.
  useEffect(() => () => { document.body.style.overflow = ''; }, []);

  async function signIn(e: string, p: string) {
    setBusy(true); setError(null);
    try {
      const r = await api<{ token: string; user: User }>('/auth/login', { method: 'POST', json: { email: e, password: p } });
      storeSession(r.token, r.user);
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduce) { router.replace('/applications'); return; }
      document.body.style.overflow = 'hidden';
      setWelcome(r.user); // play the welcome moment, then glide into the dashboard
      router.prefetch('/applications');
      window.setTimeout(() => router.replace('/applications'), 1900);
    } catch (err) { setError((err as Error).message); setBusy(false); }
  }

  const groups = (['admin', 'officer', 'regional', 'committee', 'institution'] as Role[]).map((r) => [r, (demo.data ?? []).filter((d) => d.role === r)] as const);

  const initials = (n: string) => n.replace(/\(.*\)/, '').replace(/^(Dr\.|Prof\.|Registrar,)\s*/, '').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const firstName = (n: string) => n.replace(/\(.*\)/, '').replace(/^(Dr\.|Prof\.|Registrar,)\s*/, '').trim().split(/\s+/)[0];
  const LANDING: Record<Role, string> = {
    admin: 'Opening decisions and analytics…', officer: 'Opening your review queue…',
    committee: 'Opening committee reviews…', regional: 'Opening your region…', institution: 'Opening your applications…',
  };
  const FEATURES = ['Workflow automation', 'Compliance monitoring', 'Smart alerts', 'AI risk scoring'];

  return (
    <>
    <div className={`mx-auto grid min-h-screen max-w-6xl items-center gap-10 px-6 py-10 transition duration-500 ease-out lg:grid-cols-[1.05fr_1fr] ${welcome ? 'login-leave' : ''}`}>
      <div className="rise">
        <div className="mb-6 flex items-center gap-3">
          <LogoMark size={56} />
          <Wordmark className="text-[38px]" />
        </div>
        <h1 className="max-w-md text-[41px] font-semibold leading-[1.08] tracking-[-0.03em]">Approvals, compliance and alerts, in one calm place.</h1>
        <p className="mt-3 max-w-md text-[17px] text-ink2">Integrated approval workflow automation, compliance monitoring and alert management.</p>
        <div className="mt-5 flex max-w-md flex-wrap gap-2">
          {FEATURES.map((f) => <span key={f} className="glass rounded-full px-3 py-1 text-[13px] text-ink2">{f}</span>)}
        </div>
        <form className="card mt-8 max-w-md space-y-4 p-6" onSubmit={(e) => { e.preventDefault(); void signIn(email, password); }}>
          <div><label className="label" htmlFor="email">Email</label><input id="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" /></div>
          <div><label className="label" htmlFor="pw">Password</label><input id="pw" type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></div>
          <ErrorNote message={error} />
          <button className="btn-primary w-full !py-2.5" disabled={busy}>Sign in</button>
        </form>
        <p className="mt-3 max-w-md text-[13px] text-muted">Demo password for every account: <code>demo1234</code>. All data is illustrative.</p>
      </div>
      <div className="card p-5" style={{ animationDelay: '120ms' }}>
        <h2 className="mb-3 px-1 text-[16px] font-semibold tracking-tight">One-click demo accounts</h2>
        {demo.loading && <div className="space-y-2"><div className="skeleton h-14" /><div className="skeleton h-14" /><div className="skeleton h-14" /></div>}
        {demo.error && <ErrorNote message={`Cannot reach the API (${demo.error}). Is it running?`} />}
        <div className="max-h-[30rem] space-y-4 overflow-auto pr-1">
          {groups.map(([role, list]) => list.length > 0 && (
            <div key={role}>
              <div className="mb-1.5 px-1 text-[12px] font-medium uppercase tracking-[0.07em] text-muted">{ROLE_LABEL[role]}</div>
              <div className="grid gap-1.5">
                {list.map((d) => (
                  <button key={d.email} disabled={busy} onClick={() => void signIn(d.email, 'demo1234')}
                    className="lift flex items-center gap-3 rounded-2xl bg-page px-3 py-2.5 text-left transition hover:brightness-95 disabled:opacity-60">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-soft text-[13px] font-semibold text-brand">{initials(d.name)}</span>
                    <span className="min-w-0"><span className="block truncate text-[15px] font-medium">{d.name}</span>
                      <span className="block truncate text-[13px] text-muted">{d.email}{d.institution ? ` · ${d.institution}` : ''}</span></span>
                    <span className="ml-auto text-muted" aria-hidden>›</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
    {welcome && (
      <div className="fixed inset-0 z-50 grid place-items-center" role="status" aria-live="polite">
        <div className="welcome text-center">
          <div className="relative mx-auto mb-6 grid h-20 w-20 place-items-center">
            <span className="halo absolute inset-0 rounded-[22%] bg-brand" aria-hidden />
            <LogoMark size={80} className="relative" />
          </div>
          <div className="text-[33px] font-semibold tracking-[-0.025em]">Welcome, {firstName(welcome.name)}</div>
          <div className="mt-1.5 text-[16px] text-ink2">{LANDING[welcome.role]}</div>
          <div className="mx-auto mt-6 h-1 w-44 overflow-hidden rounded-full bg-page"><div className="welcome-bar h-full w-full rounded-full bg-brand" /></div>
        </div>
      </div>
    )}
    </>
  );
}
