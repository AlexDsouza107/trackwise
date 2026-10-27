'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { api, clearSession } from '@/lib/api';
import { RequireAuth, useUser } from '@/lib/auth';
import ThemeToggle from '@/components/ThemeToggle';
import type { Notification, Role } from '@/lib/types';

const NAV: { href: string; label: string; icon: string; roles: Role[] }[] = [
  { href: '/applications', label: 'Applications', icon: '▤', roles: ['institution', 'officer', 'committee', 'regional', 'admin'] },
  { href: '/applications/new', label: 'New application', icon: '＋', roles: ['institution'] },
  { href: '/evc', label: 'Expert visits', icon: '◎', roles: ['officer', 'committee', 'regional', 'admin'] },
  { href: '/compliance', label: 'Compliance', icon: '◈', roles: ['institution', 'officer', 'committee', 'regional', 'admin'] },
  { href: '/documents', label: 'Document validity', icon: '▣', roles: ['institution', 'officer', 'committee', 'regional', 'admin'] },
  { href: '/analytics', label: 'Analytics', icon: '▥', roles: ['officer', 'committee', 'regional', 'admin'] },
  { href: '/alerts', label: 'Alerts', icon: '◔', roles: ['institution', 'officer', 'committee', 'regional', 'admin'] },
  { href: '/settings', label: 'Settings', icon: '⚙', roles: ['admin'] },
];

const ROLE_LABEL: Record<Role, string> = {
  institution: 'Institution', officer: 'Scrutiny Officer', committee: 'Committee Member', regional: 'Regional Officer', admin: 'Administrator',
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

  // Pause the drifting backdrop while the page scrolls so the blurred glass is not re-composited every frame.
  useEffect(() => {
    const root = document.documentElement;
    let t: number | undefined;
    const onScroll = () => {
      root.classList.add('scrolling');
      window.clearTimeout(t);
      t = window.setTimeout(() => root.classList.remove('scrolling'), 160);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { window.removeEventListener('scroll', onScroll); window.clearTimeout(t); root.classList.remove('scrolling'); };
  }, []);

  const items = NAV.filter((n) => n.roles.includes(user.role));
  const active = (href: string) => (href === '/applications' ? path === href || (path.startsWith('/applications/') && !path.startsWith('/applications/new')) : path.startsWith(href));

  return (
    <div className="min-h-screen md:flex">
      <aside className="aside-in glass z-10 m-3 flex flex-col rounded-[26px] md:sticky md:top-3 md:h-[calc(100vh-1.5rem)] md:w-60 md:shrink-0">
        <div className="flex items-center gap-2.5 px-5 pb-3 pt-5">
          <span className="grid h-9 w-9 place-items-center rounded-[11px] bg-brand text-[14px] font-semibold text-brand-ink shadow-[0_6px_16px_-6px_var(--brand)]">TW</span>
          <div><div className="text-[16px] font-semibold leading-tight">TrackWise</div><div className="text-[12px] leading-tight text-muted">Approval &amp; compliance</div></div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:block md:space-y-0.5 md:pb-0">
          {items.map((n) => (
            <Link key={n.href} href={n.href} aria-current={active(n.href) ? 'page' : undefined}
              className={`flex items-center gap-2.5 whitespace-nowrap rounded-xl px-3 py-2 text-[15px] transition ${active(n.href) ? 'bg-brand-soft font-medium text-brand' : 'text-ink2 hover:bg-page'}`}>
              <span aria-hidden className="w-4 text-center opacity-90">{n.icon}</span>{n.label}
              {n.href === '/alerts' && unread > 0 && <span className="ml-auto rounded-full bg-bad px-1.5 text-[12px] font-semibold text-white">{unread}</span>}
            </Link>
          ))}
        </nav>
        <div className="mt-auto hidden space-y-3 border-t border-line p-4 md:block">
          <ThemeToggle />
          <div className="px-1">
            <div className="truncate text-[14px] font-medium">{user.name}</div>
            <div className="text-[13px] text-muted">{ROLE_LABEL[user.role]}{user.region ? ` · ${user.region}` : ''}</div>
            <button className="mt-1.5 text-[13px] text-brand hover:underline" onClick={() => { clearSession(); router.replace('/login'); }}>Sign out</button>
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        <div className="main-in mx-auto max-w-6xl px-4 pb-10 pt-4 md:px-6">
          <div className="mb-5 flex justify-center">
            <span className="glass rounded-full px-3.5 py-1 text-[13px] text-ink2">Illustrative demo data · not real AICTE data</span>
          </div>
          {children}
          <div className="mt-6 md:hidden"><ThemeToggle /></div>
        </div>
      </main>
    </div>
  );
}

export default function Shell({ children }: { children: ReactNode }) {
  return <RequireAuth><Inner>{children}</Inner></RequireAuth>;
}
