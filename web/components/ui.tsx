import type { ReactNode } from 'react';
import { slaStatus, STATE_LABEL } from '@/lib/format';
import type { AppState } from '@/lib/types';

type Tone = 'good' | 'warn' | 'bad' | 'brand' | 'neutral';

const TONES: Record<Tone, string> = {
  good: 'bg-good-soft text-good-text', warn: 'bg-warn-soft text-warn-text', bad: 'bg-bad-soft text-bad-text',
  brand: 'bg-brand-soft text-brand', neutral: 'bg-page text-ink2 border border-line',
};

/** Status chips always pair color with an icon glyph + text, never color alone. */
export function Chip({ tone, icon, children }: { tone: Tone; icon?: string; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${TONES[tone]}`}>
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
  return <Chip tone={tone} icon={icon}>{text}</Chip>;
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
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>{action}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: Tone }) {
  return (
    <div className="card p-4">
      <div className="text-xs font-medium text-ink2">{label}</div>
      <div className={`mt-1 text-3xl font-semibold ${tone === 'bad' ? 'text-bad-text' : ''}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-ink2">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return <div role="alert" className="rounded-lg border border-line bg-bad-soft px-3 py-2 text-sm text-bad-text">✕ {message}</div>;
}

export function Loading() {
  return <div className="p-8 text-center text-sm text-muted">Loading…</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-line p-8 text-center text-sm text-muted">{children}</div>;
}
