'use client';
import Link from 'next/link';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { humanize } from '@/lib/format';

const axisProps = { stroke: 'var(--axis)', tick: { fill: 'var(--muted)', fontSize: 12 }, tickLine: false } as const;

function TipBox({ active, payload, label, unit }: { active?: boolean; payload?: { name: string; value: number; color?: string }[]; label?: string; unit?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-md">
      <div className="mb-1 font-medium">{label}</div>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2 text-ink2">
          <span className="h-2 w-2 rounded-sm" style={{ background: p.color }} aria-hidden />{humanize(String(p.name))}: <b className="text-ink">{p.value}{unit ?? ''}</b>
        </div>
      ))}
    </div>
  );
}

export function TrendChart({ data, xKey, yKey, name, height = 240 }: { data: Record<string, string | number>[]; xKey: string; yKey: string; name: string; height?: number }) {
  return (
    <div role="img" aria-label={`${name} over time`}>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: -12 }}>
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis dataKey={xKey} {...axisProps} />
          <YAxis domain={[0, 100]} {...axisProps} />
          <ReferenceLine y={70} stroke="var(--axis)" strokeDasharray="4 4" label={{ value: 'Target 70', fill: 'var(--muted)', fontSize: 11, position: 'insideBottomRight' }} />
          <Tooltip content={<TipBox />} cursor={{ stroke: 'var(--axis)' }} />
          <Line type="monotone" dataKey={yKey} name={name} stroke="var(--series-1)" strokeWidth={2} dot={{ r: 4, fill: 'var(--series-1)', stroke: 'var(--surface)', strokeWidth: 2 }} activeDot={{ r: 6 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function SimpleBars({ data, xKey, yKey, name, height = 240, colors, unit }: {
  data: Record<string, string | number>[]; xKey: string; yKey: string; name: string; height?: number; colors?: string[]; unit?: string;
}) {
  return (
    <div role="img" aria-label={name}>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 16, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis dataKey={xKey} {...axisProps} interval={0} />
          <YAxis {...axisProps} allowDecimals={false} />
          <Tooltip content={<TipBox unit={unit} />} cursor={{ fill: 'var(--brand-soft)' }} />
          <Bar dataKey={yKey} name={name} radius={[4, 4, 0, 0]} maxBarSize={44} label={{ position: 'top', fill: 'var(--ink-2)', fontSize: 11 }}>
            {data.map((_, i) => <Cell key={i} fill={colors?.[i] ?? 'var(--series-1)'} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export const KIND_SERIES: { key: string; label: string; color: string }[] = [
  { key: 'SLA_BREACH', label: 'SLA breach', color: 'var(--series-1)' },
  { key: 'APPROVAL_EXPIRING', label: 'Approval expiring', color: 'var(--series-2)' },
  { key: 'MISSING_DOCUMENTS', label: 'Missing documents', color: 'var(--series-3)' },
];

export function StackedAlerts({ data, height = 260 }: { data: Record<string, string | number>[]; height?: number }) {
  return (
    <div role="img" aria-label="Alert volume by day and kind">
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis dataKey="day" {...axisProps} tickFormatter={(d: string) => d.slice(5)} />
          <YAxis {...axisProps} allowDecimals={false} />
          <Tooltip content={<TipBox />} cursor={{ fill: 'var(--brand-soft)' }} />
          <Legend iconType="square" formatter={(v: string) => <span style={{ color: 'var(--ink-2)', fontSize: 12 }}>{KIND_SERIES.find((k) => k.key === v)?.label ?? v}</span>} />
          {KIND_SERIES.map((k, i) => (
            // 2px surface stroke acts as the gap between stacked segments
            <Bar key={k.key} dataKey={k.key} name={k.label} stackId="a" fill={k.color} stroke="var(--surface)" strokeWidth={2} radius={i === KIND_SERIES.length - 1 ? [4, 4, 0, 0] : 0} maxBarSize={40} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface HeatInst {
  id: number; name: string; city: string; score: number | null; delta: number | null;
  results: Record<string, { passed: boolean; score: number; detail: string }>;
}

/** Institution x rule matrix. Every cell pairs color with a glyph and a number, never color alone. */
export function Heatmap({ rules, institutions, onSelect, selectedId }: {
  rules: { code: string; name: string; severity: string }[]; institutions: HeatInst[]; onSelect?: (id: number) => void; selectedId?: number | null;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-separate border-spacing-0.5 text-sm">
        <thead><tr>
          <th className="th">Institution</th>
          {rules.map((r) => <th key={r.code} className="th text-center">{r.name}<div className="normal-case text-[10px] font-normal">{r.severity}</div></th>)}
          <th className="th text-center">Score</th>
        </tr></thead>
        <tbody>
          {institutions.map((i) => (
            <tr key={i.id} className={onSelect ? 'cursor-pointer' : ''} onClick={() => onSelect?.(i.id)}>
              <td className={`rounded-md px-3 py-2 ${selectedId === i.id ? 'bg-brand-soft font-medium' : ''}`}>
                <div className="truncate font-medium">{i.name}</div><div className="text-xs text-muted">{i.city}</div>
              </td>
              {rules.map((r) => {
                const res = i.results[r.code];
                if (!res) return <td key={r.code} className="text-center text-muted">-</td>;
                const full = res.score >= 0.999;
                const tone = !res.passed ? 'bg-bad-soft text-bad-text' : full ? 'bg-good-soft text-good-text' : 'bg-warn-soft text-warn-text';
                return (
                  <td key={r.code} title={res.detail} className={`rounded-md px-2 py-2 text-center text-xs font-medium ${tone}`}>
                    {!res.passed ? '✕' : full ? '✓' : '!'} {Math.round(res.score * 100)}%
                  </td>
                );
              })}
              <td className="px-2 py-2 text-center">
                <b>{i.score !== null ? Math.round(i.score) : '-'}</b>
                {i.delta !== null && i.delta !== 0 && <span className={`ml-1 text-xs ${i.delta > 0 ? 'text-good-text' : 'text-bad-text'}`}>{i.delta > 0 ? '▲' : '▼'}{Math.abs(Math.round(i.delta))}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-muted">✓ compliant · ! compliant with partial credit (e.g. accreditation expiring) · ✕ failing. Hover a cell for the measured value. <Link href="/compliance" className="text-brand hover:underline">Open compliance monitor</Link></p>
    </div>
  );
}
