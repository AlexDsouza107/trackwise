import { assign, getNextSnapshot, setup } from 'xstate';
import { ApplicationType, Role } from '../common/types';

/** Stages a route may contain, in the only order they can occur. Decision is always the last step. */
export type ReviewStage = 'document_scrutiny' | 'compliance_check' | 'evc_visit' | 'committee_review';
export const REVIEW_ORDER: ReviewStage[] = ['document_scrutiny', 'compliance_check', 'evc_visit', 'committee_review'];

export type AppState = 'draft' | 'submitted' | ReviewStage | 'decision' | 'deficiency' | 'approved' | 'rejected';

export type DeficiencyOrigin = ReviewStage | 'decision';
const DEFICIENCY_ORIGINS: DeficiencyOrigin[] = [...REVIEW_ORDER, 'decision'];

export const STATE_LABELS: Record<AppState, string> = {
  draft: 'Draft', submitted: 'Submitted', document_scrutiny: 'Document Scrutiny', compliance_check: 'Compliance Check',
  evc_visit: 'Expert Visit (EVC)', committee_review: 'Expert Committee Review', decision: 'Decision',
  deficiency: 'Deficiency', approved: 'Approved', rejected: 'Rejected',
};

/** Illustrative default routing per application type. Admins can change it (Settings > Workflow routes). */
export const DEFAULT_ROUTES: Record<ApplicationType, ReviewStage[]> = {
  new_institution: ['document_scrutiny', 'compliance_check', 'evc_visit', 'committee_review'],
  new_course: ['document_scrutiny', 'compliance_check', 'committee_review'],
  intake_increase: ['document_scrutiny', 'compliance_check', 'evc_visit', 'committee_review'],
  extension_of_approval: ['document_scrutiny', 'compliance_check'],
};

/** Validates a route and returns it in canonical order without duplicates. */
export function normaliseRoute(stages: unknown): ReviewStage[] {
  const set = new Set(Array.isArray(stages) ? stages : []);
  const route = REVIEW_ORDER.filter((s) => set.has(s));
  if (!route.length) throw new Error('A route needs at least one review stage');
  return route;
}

/** The stage that follows `from` on a route (`null` = right after intake); the decision when the route is exhausted. */
export function nextStage(route: ReviewStage[] | undefined, from: AppState | null): AppState {
  const r = route?.length ? route : REVIEW_ORDER;
  const after = from === null ? -1 : REVIEW_ORDER.indexOf(from as ReviewStage);
  return r.find((s) => REVIEW_ORDER.indexOf(s) > after) ?? 'decision';
}

export interface AppContext {
  deficiencyFrom: DeficiencyOrigin | null;
  deficiencyRounds: number;
  recommendation: 'approve' | 'reject' | null;
  /** Review stages this application passes through, fixed when it is submitted. */
  route: ReviewStage[];
}

export type AppEvent =
  | { type: 'SUBMIT'; route?: ReviewStage[] }
  | { type: 'INTAKE' }
  | { type: 'PASS_SCRUTINY' }
  | { type: 'CLEAR_COMPLIANCE'; criticalFailures: number }
  | { type: 'COMPLETE_EVC'; reportFiled: boolean }
  | { type: 'RECOMMEND'; outcome: 'approve' | 'reject' }
  | { type: 'RAISE_DEFICIENCY' }
  | { type: 'RESUBMIT' }
  | { type: 'APPROVE' }
  | { type: 'REJECT' };

export type EventType = AppEvent['type'];

const raise = (from: DeficiencyOrigin) => ({
  target: 'deficiency' as const,
  actions: { type: 'noteDeficiency' as const, params: { from } },
});

/** Every stage that could follow `from`; the `advanceTo` guard picks the one the route says comes next. */
const forward = (from: AppState | null) => {
  const start = from === null ? 0 : REVIEW_ORDER.indexOf(from as ReviewStage) + 1;
  return [...REVIEW_ORDER.slice(start), 'decision' as const].map((to) => ({
    guard: { type: 'advanceTo' as const, params: { from, to } },
    target: to,
  }));
};

export const applicationMachine = setup({
  types: { context: {} as AppContext, events: {} as AppEvent },
  actions: {
    noteDeficiency: assign(({ context }, params: { from: DeficiencyOrigin }) => ({
      deficiencyFrom: params.from,
      deficiencyRounds: context.deficiencyRounds + 1,
    })),
  },
  guards: {
    /** Moves forward to `to` only if the route says it is next, and the stage's own gate is open. */
    advanceTo: ({ context, event }, params: { from: AppState | null; to: AppState }) => {
      if (nextStage(context.route, params.from) !== params.to) return false;
      if (event.type === 'CLEAR_COMPLIANCE') return event.criticalFailures === 0;
      if (event.type === 'COMPLETE_EVC') return event.reportFiled;
      return true;
    },
    returnTo: ({ context }, params: { stage: DeficiencyOrigin }) => context.deficiencyFrom === params.stage,
  },
}).createMachine({
  id: 'application',
  initial: 'draft',
  context: { deficiencyFrom: null, deficiencyRounds: 0, recommendation: null, route: REVIEW_ORDER },
  states: {
    draft: {
      on: {
        SUBMIT: {
          target: 'submitted',
          actions: assign({ route: ({ context, event }) => (event.type === 'SUBMIT' && event.route ? event.route : context.route) }),
        },
      },
    },
    submitted: { on: { INTAKE: forward(null) } },
    document_scrutiny: {
      on: {
        PASS_SCRUTINY: forward('document_scrutiny'),
        RAISE_DEFICIENCY: raise('document_scrutiny'),
        REJECT: 'rejected',
      },
    },
    compliance_check: {
      on: {
        CLEAR_COMPLIANCE: forward('compliance_check'),
        RAISE_DEFICIENCY: raise('compliance_check'),
      },
    },
    evc_visit: {
      on: {
        COMPLETE_EVC: forward('evc_visit'),
        RAISE_DEFICIENCY: raise('evc_visit'),
      },
    },
    committee_review: {
      on: {
        RECOMMEND: {
          target: 'decision',
          actions: assign({ recommendation: ({ event }) => (event.type === 'RECOMMEND' ? event.outcome : null) }),
        },
        RAISE_DEFICIENCY: raise('committee_review'),
      },
    },
    decision: {
      on: {
        APPROVE: 'approved',
        REJECT: 'rejected',
        RAISE_DEFICIENCY: raise('decision'),
      },
    },
    deficiency: {
      on: {
        RESUBMIT: DEFICIENCY_ORIGINS.map((stage) => ({ guard: { type: 'returnTo' as const, params: { stage } }, target: stage })),
      },
    },
    approved: { type: 'final' },
    rejected: { type: 'final' },
  },
});

export interface Persisted {
  state: AppState;
  context: AppContext;
}

const toSnapshot = (p: Persisted) => applicationMachine.resolveState({ value: p.state, context: p.context });

export function canSend(p: Persisted, event: AppEvent): boolean {
  return toSnapshot(p).can(event);
}

/** Pure transition: returns the next persisted state, or null if the event is not allowed. */
export function send(p: Persisted, event: AppEvent): Persisted | null {
  const snap = toSnapshot(p);
  if (!snap.can(event)) return null;
  const next = getNextSnapshot(applicationMachine, snap, event);
  return { state: next.value as AppState, context: next.context };
}

/** Hours the current stage is allowed to take before the SLA is breached (illustrative). */
export const SLA_HOURS: Partial<Record<AppState, number>> = {
  submitted: 24,
  document_scrutiny: 72,
  compliance_check: 72,
  evc_visit: 336,
  committee_review: 120,
  decision: 48,
  deficiency: 240,
};

export const FINAL_STATES: AppState[] = ['approved', 'rejected'];

export interface ActionDef {
  event: EventType;
  label: string;
  tone: 'primary' | 'danger' | 'warning' | 'neutral';
  roles: Role[];
  requiresNote: boolean;
  /** Extra event payload; used for the two RECOMMEND variants. */
  payload?: Record<string, unknown>;
  key: string;
}

/** Who may fire which event. The machine decides *whether* it is valid in the current state. */
export const ACTIONS: ActionDef[] = [
  { key: 'submit', event: 'SUBMIT', label: 'Submit application', tone: 'primary', roles: ['institution'], requiresNote: false },
  { key: 'resubmit', event: 'RESUBMIT', label: 'Resubmit with corrections', tone: 'primary', roles: ['institution'], requiresNote: true },
  { key: 'pass', event: 'PASS_SCRUTINY', label: 'Documents verified', tone: 'primary', roles: ['officer', 'admin'], requiresNote: false },
  { key: 'clear', event: 'CLEAR_COMPLIANCE', label: 'Compliance cleared', tone: 'primary', roles: ['officer', 'admin'], requiresNote: false },
  { key: 'evc_complete', event: 'COMPLETE_EVC', label: 'EVC visit complete', tone: 'primary', roles: ['committee', 'regional', 'admin'], requiresNote: true },
  { key: 'rec_approve', event: 'RECOMMEND', label: 'Recommend approval', tone: 'primary', roles: ['committee', 'admin'], requiresNote: true, payload: { outcome: 'approve' } },
  { key: 'rec_reject', event: 'RECOMMEND', label: 'Recommend rejection', tone: 'danger', roles: ['committee', 'admin'], requiresNote: true, payload: { outcome: 'reject' } },
  { key: 'approve', event: 'APPROVE', label: 'Approve', tone: 'primary', roles: ['admin'], requiresNote: false },
  { key: 'reject', event: 'REJECT', label: 'Reject', tone: 'danger', roles: ['officer', 'admin'], requiresNote: true },
  { key: 'deficiency', event: 'RAISE_DEFICIENCY', label: 'Raise deficiency', tone: 'warning', roles: ['officer', 'committee', 'regional', 'admin'], requiresNote: true },
];
