'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Card, Empty, ErrorNote, Loading, PageHeader, RiskChip, SlaChip, StateBadge } from '@/components/ui';
import { useApi } from '@/lib/api';
import { useUser } from '@/lib/auth';
import { humanize, REGIONS } from '@/lib/format';
import type { AppSummary } from '@/lib/types';

export default function Applications() {
  const user = useUser();
  const router = useRouter();
  const staff = user.role !== 'institution';
  const [scope, setScope] = useState<'queue' | 'all'>('queue');
  const [region, setRegion] = useState('');
  const pinned = user.role === 'regional';
  const { data, error, loading } = useApi<AppSummary[]>(`/applications?scope=${staff ? scope : 'mine'}${region && !pinned ? `&region=${region}` : ''}`, 20000);

  const queueHint: Record<string, string> = {
    officer: 'Document scrutiny and compliance stages, ordered by SLA urgency.',
    regional: `Expert visits to schedule or follow up in the ${user.region ?? ''} region, ordered by SLA urgency.`,
    committee: 'Applications awaiting expert committee review, ordered by SLA urgency.',
    admin: 'Applications awaiting a final decision. Switch to "All" for the full pipeline.',
  };

  return (
    <>
      <PageHeader
        title={staff ? (scope === 'queue' ? 'My review queue' : 'All applications') : 'My applications'}
        subtitle={staff ? queueHint[user.role] : 'Submit new applications and track their status.'}
        action={staff ? (
          <div className="flex flex-wrap items-center gap-2">
            {pinned ? <span className="rounded-full bg-brand-soft px-3 py-1 text-[13px] font-medium text-brand">{user.region} region</span> : (
              <select className="input !w-auto !py-1.5 text-[14px]" aria-label="Region" value={region} onChange={(e) => setRegion(e.target.value)}>
                <option value="">All regions</option>{REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            )}
            <div className="seg" role="tablist">
              {(['queue', 'all'] as const).map((s) => (
                <button key={s} role="tab" aria-selected={scope === s} onClick={() => setScope(s)}
                  className="seg-item">{s === 'queue' ? 'Queue' : 'All'}</button>
              ))}
            </div>
          </div>
        ) : <Link href="/applications/new" className="btn-primary">＋ New application</Link>}
      />
      <ErrorNote message={error} />
      {loading && <Loading />}
      {data && data.length === 0 && <Empty>Nothing here yet.</Empty>}
      {data && data.length > 0 && (
        <Card className="overflow-hidden !p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px]">
              <thead className="border-b border-line"><tr>
                <th className="th">Reference</th><th className="th">Application</th><th className="th">Stage</th>
                <th className="th">SLA</th><th className="th">AI risk</th><th className="th">Deficiencies</th>
              </tr></thead>
              <tbody className="divide-y divide-line">
                {data.map((a) => (
                  <tr key={a.id} className="cursor-pointer hover:bg-page" onClick={() => router.push(`/applications/${a.id}`)}>
                    <td className="td font-mono text-xs"><Link href={`/applications/${a.id}`} className="text-brand hover:underline">{a.reference}</Link></td>
                    <td className="td"><div className="font-medium">{a.title}</div><div className="text-xs text-muted">{staff ? `${a.institution_name} · ` : ''}{humanize(a.type)}{staff && a.region ? ` · ${a.region}` : ''}</div></td>
                    <td className="td"><StateBadge state={a.state} /></td>
                    <td className="td"><SlaChip hoursLeft={a.sla_hours_left} /></td>
                    <td className="td"><RiskChip level={a.risk_level} score={a.risk_score} /></td>
                    <td className="td text-ink2">{a.deficiency_rounds && a.deficiency_rounds !== '0' ? a.deficiency_rounds : '-'}</td>
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
