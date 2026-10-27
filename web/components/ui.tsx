'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { slaStatus, STATE_LABEL } from '@/lib/format';
import type { AppState } from '@/lib/types';

type Tone = 'good' | 'warn' | 'bad' | 'brand' | 'neutral';

const TONES: Record<Tone, string> = {
  good: 'bg-good-soft text-good-text', warn: 'bg-warn-soft text-warn-text', bad: 'bg-bad-soft text-bad-text',
  brand: 'bg-brand-soft text-brand', neutral: 'bg-page text-ink2',
};

/** Status chips always pair color with an icon glyph + text, never color alone. */
export function Chip({ tone, icon, children }: { tone: Tone; icon?: string; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-[3px] text-[13px] font-medium ${TONES[tone]}`}>
      {icon && <span aria-hidden>{icon}</span>}{children}
    </span>
  );
}

export function StateBadge({ state }: { state: AppState }) {
  const tone: Tone = state === 'approved' ? 'good' : state === 'rejected' ? 'bad' : state === 'deficiency' ? 'warn' : state === 'draft' ? 'neutral' : 'brand';
  const icon = state === 'approved' ? '✓' : state === 'rejected' ? '✕' : state === 'deficiency' ? '!' : '●';
  return <Chip tone={tone} icon={icon}>{STATE_LABEL[state]}</Chip>;
}

export function SlaChip({ hoursLeft }: { hoursLeft: string | number | null }) {
  const { status, text } = slaStatus(hoursLeft);
  if (status === 'none') return <span className="text-muted">-</span>;
  const map = { ok: ['good', '✓'], risk: ['warn', '!'], breached: ['bad', '✕'] } as const;
  const [tone, icon] = map[status];
  return <span className={status === 'breached' ? 'pulse-bad rounded-full' : ''}><Chip tone={tone} icon={icon}>{text}</Chip></span>;
}

export function RiskChip({ level, score }: { level: string | null; score?: string | number | null }) {
  if (!level) return <span className="text-muted">-</span>;
  const map: Record<string, [Tone, string]> = { low: ['good', '✓'], medium: ['warn', '!'], high: ['bad', '✕'] };
  const [tone, icon] = map[level] ?? ['neutral', '·'];
  return <Chip tone={tone} icon={icon}>{level[0].toUpperCase() + level.slice(1)}{score != null ? ` ${Math.round(Number(score))}` : ''}</Chip>;
}

export function Card({ title, action, children, className = '' }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 px-5 pb-1 pt-4">
          <h2 className="text-[16px] font-semibold tracking-tight">{title}</h2>{action}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

/** Animates integers from 0 on mount; respects reduced motion. */
function CountUp({ to }: { to: number }) {
  const [n, setN] = useState(to);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || to === 0) { setN(to); return; }
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / 900);
      setN(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    setN(0);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to]);
  return <>{n}</>;
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: Tone }) {
  return (
    <div className="card lift p-5">
      <div className="text-[13px] font-medium text-ink2">{label}</div>
      <div className={`mt-1.5 text-[35px] font-semibold leading-none tracking-tight ${tone === 'bad' ? 'text-bad-text' : ''}`}>{typeof value === 'number' ? <CountUp to={value} /> : value}</div>
      {hint && <div className="mt-2 text-[13px] text-muted">{hint}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[31px] font-semibold leading-tight tracking-[-0.022em]">{title}</h1>
        {subtitle && <p className="mt-1 text-[15px] text-ink2">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return <div role="alert" className="rounded-xl bg-bad-soft px-3.5 py-2.5 text-sm text-bad-text">✕ {message}</div>;
}

export function Loading() {
  return (
    <div className="space-y-3" role="status" aria-label="Loading">
      <div className="skeleton h-8 w-56" />
      <div className="skeleton h-4 w-80" />
      <div className="skeleton mt-4 h-40 w-full" /><div className="skeleton h-40 w-full" />
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-dashed border-line p-8 text-center text-sm text-muted">{children}</div>;
}
