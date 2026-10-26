'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { api, clearSession } from '@/lib/api';
import { RequireAuth, useUser } from '@/lib/auth';
import type { Notification, Role } from '@/lib/types';

const NAV: { href: string; label: string; icon: string; roles: Role[] }[] = [
  { href: '/applications', label: 'Applications', icon: '▤', roles: ['institution', 'officer', 'committee', 'admin'] },
  { href: '/applications/new', label: 'New application', icon: '＋', roles: ['institution'] },
  { href: '/compliance', label: 'Compliance', icon: '◈', roles: ['institution', 'officer', 'committee', 'admin'] },
  { href: '/analytics', label: 'Analytics', icon: '▥', roles: ['officer', 'committee', 'admin'] },
  { href: '/alerts', label: 'Alerts', icon: '◔', roles: ['institution', 'officer', 'committee', 'admin'] },
];

const ROLE_LABEL: Record<Role, string> = {
  institution: 'Institution', officer: 'Scrutiny Officer', committee: 'Committee Member', admin: 'Administrator',
};

function Inner({ children }: { children: ReactNode }) {
  const user = useUser();
  const path = usePathname();
  const router = useRouter();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const r = await api<{ unread: number; items: Notification[] }>('/notifications');
        if (alive) setUnread(r.unread);
      } catch { /* bell is best-effort */ }
    };
    void poll();
    const t = setInterval(poll, 15000);
    return () => { alive = false; clearInterval(t); };
  }, [path]);

  const items = NAV.filter((n) => n.roles.includes(user.role));
  const active = (href: string) => (href === '/applications' ? path === href || (path.startsWith('/applications/') && !path.startsWith('/applications/new')) : path.startsWith(href));

  return (
    <div className="min-h-screen md:flex">
      <aside className="border-b border-line bg-surface md:sticky md:top-0 md:h-screen md:w-60 md:shrink-0 md:border-b-0 md:border-r">
        <div className="flex items-center justify-between px-4 py-4 md:block">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand text-sm font-bold text-brand-ink">TW</span>
            <div><div className="text-sm font-semibold leading-tight">TrackWise</div><div className="text-[11px] leading-tight text-muted">Approval &amp; compliance</div></div>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:block md:space-y-1 md:pb-0">
          {items.map((n) => (
            <Link key={n.href} href={n.href} aria-current={active(n.href) ? 'page' : undefined}
              className={`flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm ${active(n.href) ? 'bg-brand-soft font-medium text-brand' : 'text-ink2 hover:bg-page'}`}>
              <span aria-hidden className="w-4 text-center">{n.icon}</span>{n.label}
              {n.href === '/alerts' && unread > 0 && <span className="ml-auto rounded-full bg-bad px-1.5 text-[11px] font-semibold text-white">{unread}</span>}
            </Link>
          ))}
        </nav>
        <div className="hidden border-t border-line p-4 text-sm md:absolute md:bottom-0 md:block md:w-60">
          <div className="font-medium">{user.name}</div>
          <div className="text-xs text-muted">{ROLE_LABEL[user.role]}</div>
          <button className="mt-2 text-xs text-brand hover:underline" onClick={() => { clearSession(); router.replace('/login'); }}>Sign out</button>
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        <div className="border-b border-line bg-warn-soft px-4 py-1.5 text-center text-xs text-warn-text">
          ⚠ Illustrative demo data. Institutions, people, norms and figures are invented and are not real AICTE data.
        </div>
        <div className="mx-auto max-w-6xl p-4 md:p-6">{children}</div>
      </main>
    </div>
  );
}

export default function Shell({ children }: { children: ReactNode }) {
  return <RequireAuth><Inner>{children}</Inner></RequireAuth>;
}
