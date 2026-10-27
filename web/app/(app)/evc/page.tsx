'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Card, Chip, Empty, ErrorNote, Loading, PageHeader, SlaChip } from '@/components/ui';
import { useApi } from '@/lib/api';
import { useUser } from '@/lib/auth';
import { fmtDate, REGIONS } from '@/lib/format';

interface Visit {
  id: number; status: 'awaiting_schedule' | 'scheduled' | 'completed'; round: number; scheduled_for: string | null; venue: string | null;
  outcome: string | null; application_id: number; reference: string; title: string; state: string; sla_due_at: string | null;
  institution_name: string; city: string; region: string | null; members: string[];
}

const FILTERS = [['', 'All'], ['awaiting_schedule', 'To schedule'], ['scheduled', 'Scheduled'], ['completed', 'Report filed']] as const;

/** Queue of Expert Visit Committee visits: what needs scheduling, what is coming up and what is overdue for a report. */
export default function EvcPage() {
  const user = useUser();
  const pinned = user.role === 'regional';
  const [status, setStatus] = useState('');
  const [region, setRegion] = useState('');
  const { data, error, loading } = useApi<Visit[]>(`/evc/visits?${status ? `status=${status}&` : ''}${region && !pinned ? `region=${region}` : ''}`, 30000);
  const now = Date.now();

  const when = (v: Visit) => {
    if (v.status === 'awaiting_schedule') return <Chip tone="warn" icon="!">Needs scheduling</Chip>;
    if (!v.scheduled_for) return null;
    const t = new Date(v.scheduled_for).getTime();
    if (v.status === 'completed') return <Chip tone="good" icon="✓">Report filed</Chip>;
    return t < now ? <Chip tone="bad" icon="✕">Report overdue {Math.max(1, Math.round((now - t) / 3_600_000))}h</Chip>
      : <Chip tone="brand" icon="●">In {Math.max(1, Math.round((t - now) / 3_600_000))}h</Chip>;
  };

  return (
    <>
      <PageHeader title="Expert visits" subtitle="Expert Visit Committee scheduling, member assignment and reports. Unscheduled visits, upcoming reminders and overdue reports escalate automatically."
        action={
          <div className="flex flex-wrap items-center gap-2">
            {pinned ? <span className="rounded-full bg-brand-soft px-3 py-1 text-[13px] font-medium text-brand">{user.region} region</span> : (
              <select className="input !w-auto !py-1.5 text-[14px]" aria-label="Region" value={region} onChange={(e) => setRegion(e.target.value)}>
                <option value="">All regions</option>{REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            )}
            <div className="seg" role="tablist">
              {FILTERS.map(([k, label]) => <button key={k} role="tab" aria-selected={status === k} className="seg-item" onClick={() => setStatus(k)}>{label}</button>)}
            </div>
          </div>} />
      <ErrorNote message={error} />
      {loading && <Loading />}
      {data && data.length === 0 && <Empty>No visits match.</Empty>}
      {data && data.length > 0 && (
        <Card className="overflow-hidden !p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px]">
              <thead className="border-b border-line"><tr>
                <th className="th">Application</th><th className="th">Region</th><th className="th">Visit</th><th className="th">Members</th><th className="th">Status</th><th className="th">Stage SLA</th>
              </tr></thead>
              <tbody className="divide-y divide-line">
                {data.map((v) => (
                  <tr key={v.id} className="hover:bg-page">
                    <td className="td"><Link href={`/applications/${v.application_id}`} className="font-medium text-brand hover:underline">{v.title}</Link>
                      <div className="text-xs text-muted">{v.reference} · {v.institution_name}, {v.city}{v.round > 1 ? ` · round ${v.round}` : ''}</div></td>
                    <td className="td text-ink2">{v.region}</td>
                    <td className="td text-sm">{v.scheduled_for ? <>{fmtDate(v.scheduled_for)}<div className="text-xs text-muted">{v.venue}</div></> : <span className="text-muted">-</span>}</td>
                    <td className="td text-xs text-ink2">{v.members.length ? v.members.join(', ') : '-'}</td>
                    <td className="td">{when(v)}</td>
                    <td className="td">{v.state === 'evc_visit' && v.sla_due_at ? <SlaChip hoursLeft={(new Date(v.sla_due_at).getTime() - now) / 3_600_000} /> : <span className="text-muted">-</span>}</td>
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
