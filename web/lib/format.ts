import type { AppState } from './types';

export const STATE_LABEL: Record<AppState, string> = {
  draft: 'Draft', submitted: 'Submitted', document_scrutiny: 'Document Scrutiny', compliance_check: 'Compliance Check',
  evc_visit: 'Expert Visit (EVC)', committee_review: 'Expert Committee Review', decision: 'Decision', deficiency: 'Deficiency', approved: 'Approved', rejected: 'Rejected',
};

/** Stages shown in the progress stepper for an application's own route. */
export const stagesFor = (route: AppState[]): AppState[] => ['submitted', ...route, 'decision', 'approved'];

export const REGIONS = ['Northern', 'Southern', 'Eastern', 'Western', 'Central'] as const;

export const STATUS_LABEL: Record<string, string> = { valid: 'Valid', expiring: 'Expiring soon', expired: 'Expired', renewal_pending: 'Renewal pending' };

export const humanize = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function fmtHours(h: number | null | undefined): string {
  if (h === null || h === undefined) return '-';
  if (h < 48) return `${Math.round(h)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

export const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

export type SlaStatus = 'none' | 'ok' | 'risk' | 'breached';
export function slaStatus(hoursLeft: string | number | null): { status: SlaStatus; text: string } {
  if (hoursLeft === null || hoursLeft === undefined) return { status: 'none', text: '-' };
  const h = Number(hoursLeft);
  if (h < 0) return { status: 'breached', text: `Overdue ${fmtHours(-h)}` };
  if (h < 24) return { status: 'risk', text: `${fmtHours(h)} left` };
  return { status: 'ok', text: `${fmtHours(h)} left` };
}
