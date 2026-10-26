export type Role = 'institution' | 'officer' | 'committee' | 'admin';

export interface User { id: number; name: string; email: string; role: Role; institutionId: number | null }

export type AppState =
  | 'draft' | 'submitted' | 'document_scrutiny' | 'compliance_check'
  | 'committee_review' | 'decision' | 'deficiency' | 'approved' | 'rejected';

export interface AppSummary {
  id: number; reference: string; type: string; title: string; state: AppState; stage_entered_at: string;
  sla_due_at: string | null; sla_hours_left: string | null; risk_score: string | null; risk_level: string | null;
  submitted_at: string | null; decided_at: string | null; deficiency_rounds: string | null; institution_name: string; city: string;
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
  context: { deficiencyRounds: number; deficiencyFrom: string | null; recommendation: 'approve' | 'reject' | null };
  institution: { id: number; name: string; code: string; city: string; state: string; approval_valid_until: string | null };
  documents: { id: number; doc_type: string; filename: string; content_type: string; size_bytes: number; uploaded_at: string }[];
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
