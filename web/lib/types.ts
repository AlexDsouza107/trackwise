export type Role = 'institution' | 'officer' | 'committee' | 'regional' | 'admin';

export interface User { id: number; name: string; email: string; role: Role; institutionId: number | null; region: string | null }

export type AppState =
  | 'draft' | 'submitted' | 'document_scrutiny' | 'compliance_check' | 'evc_visit'
  | 'committee_review' | 'decision' | 'deficiency' | 'approved' | 'rejected';

export interface AppSummary {
  id: number; reference: string; type: string; title: string; state: AppState; stage_entered_at: string;
  sla_due_at: string | null; sla_hours_left: string | null; risk_score: string | null; risk_level: string | null;
  submitted_at: string | null; decided_at: string | null; deficiency_rounds: string | null; institution_name: string; city: string; region: string | null;
}

export interface RuleOutcome { ruleCode: string; passed: boolean; score: number; value: number | null; threshold: number | null; detail: string }

export interface AuditEntry {
  id: number; event: string; from_state: string | null; to_state: string | null; actor_name: string; actor_role: string;
  note: string | null; created_at: string;
}

export interface DocFinding { severity: 'info' | 'warning' | 'critical'; code: string; message: string; doc_type?: string | null }

export interface ApplicationDetail extends AppSummary {
  typeLabel: string;
  details: Record<string, string | number>;
  context: { deficiencyRounds: number; deficiencyFrom: string | null; recommendation: 'approve' | 'reject' | null; route: AppState[] };
  route: AppState[];
  nextStage: AppState;
  evc: EvcVisit | null;
  validity: { kind: string; valid_until: string; renewal_pending: boolean }[];
  institution: { id: number; name: string; code: string; city: string; state: string; region: string | null; approval_valid_until: string | null };
  documents: { id: number; doc_type: string; filename: string; content_type: string; size_bytes: number; source: string; uploaded_at: string }[];
  audit: AuditEntry[];
  requiredDocuments: string[];
  availableActions: { key: string; label: string; tone: 'primary' | 'danger' | 'warning' | 'neutral'; requiresNote: boolean }[];
  doc_check: { completeness_pct: number; missing: string[]; findings: DocFinding[]; model_version: string } | null;
  risk_factors: { factors: { feature: string; label: string; points: number; detail: string }[]; modelVersion: string } | null;
  compliance: { score: number; criticalFailures: number; outcomes: RuleOutcome[]; evaluatedAt: string; note?: string } | null;
}

export interface Notification {
  id: number; kind: string; severity: 'info' | 'warning' | 'critical'; title: string; body: string; link: string | null;
  read_at: string | null; created_at: string;
}

export interface EvcVisit {
  id: number; application_id: number; round: number; status: 'awaiting_schedule' | 'scheduled' | 'completed';
  scheduled_for: string | null; venue: string | null; member_ids: number[]; scheduled_by_name: string | null;
  report: { outcome: 'satisfactory' | 'minor_gaps' | 'major_gaps'; findings: string; filedBy: string; filedAt: string } | null;
  members: { id: number; name: string }[];
}

export interface ValidityDoc {
  id: number; institution_id: number; institution_name: string; region: string | null; kind: string; kind_label: string; reference: string | null;
  valid_until: string; days_left: number; status: 'valid' | 'expiring' | 'expired' | 'renewal_pending'; filename: string;
  verified_at: string | null; verified_by_name: string | null;
  renewal: { validUntil: string; filename: string; submittedBy: string; submittedAt: string; note: string | null } | null;
  history: { at: string; actor: string; event: string; validUntil?: string; note?: string }[];
}
