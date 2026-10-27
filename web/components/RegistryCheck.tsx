'use client';
import { Chip } from '@/components/ui';
import { useApi } from '@/lib/api';

interface Result {
  registry: { source: string; status: string; validUntil: string | null; grade: string | null };
  recorded: string | null; match: boolean; differenceDays: number | null;
}

/** Cross-checks the accreditation date recorded for an institution against the (mock) accreditation registry. */
export default function RegistryCheck({ institutionId }: { institutionId: number }) {
  const { data } = useApi<Result>(`/integrations/accreditation/${institutionId}`);
  if (!data) return null;
  const { registry: r } = data;
  if (r.status === 'not_found') return <p className="mt-3 text-xs text-muted">Registry check: no accreditation on record for this institution.</p>;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-page px-3 py-2 text-xs">
      <Chip tone={data.match ? 'good' : 'warn'} icon={data.match ? '✓' : '!'}>{data.match ? 'Registry match' : 'Registry mismatch'}</Chip>
      <span className="text-ink2">
        {r.source}: valid until {r.validUntil}{r.grade ? `, grade ${r.grade}` : ''}. Recorded: {data.recorded}.
        {!data.match && data.differenceDays !== null ? ` The registry is ${Math.abs(data.differenceDays)} day(s) ${data.differenceDays < 0 ? 'earlier' : 'later'}; verify before relying on it.` : ''}
      </span>
    </div>
  );
}
