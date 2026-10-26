import { assign, getNextSnapshot, setup } from 'xstate';
import { Role } from '../common/types';

export type AppState =
  | 'draft' | 'submitted' | 'document_scrutiny' | 'compliance_check'
  | 'committee_review' | 'decision' | 'deficiency' | 'approved' | 'rejected';

export type DeficiencyOrigin = Exclude<AppState, 'draft' | 'submitted' | 'deficiency' | 'approved' | 'rejected'>;

export interface AppContext {
  deficiencyFrom: DeficiencyOrigin | null;
  deficiencyRounds: number;
  recommendation: 'approve' | 'reject' | null;
}

export type AppEvent =
  | { type: 'SUBMIT' }
  | { type: 'INTAKE' }
  | { type: 'PASS_SCRUTINY' }
  | { type: 'CLEAR_COMPLIANCE'; criticalFailures: number }
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

export const applicationMachine = setup({
  types: { context: {} as AppContext, events: {} as AppEvent },
  actions: {
    noteDeficiency: assign(({ context }, params: { from: DeficiencyOrigin }) => ({
      deficiencyFrom: params.from,
      deficiencyRounds: context.deficiencyRounds + 1,
    })),
  },
  guards: {
    complianceClear: ({ event }) => event.type === 'CLEAR_COMPLIANCE' && event.criticalFailures === 0,
    recommendsApprove: ({ event }) => event.type === 'RECOMMEND' && event.outcome === 'approve',
    returnTo: ({ context }, params: { stage: DeficiencyOrigin }) => context.deficiencyFrom === params.stage,
  },
}).createMachine({
  id: 'application',
  initial: 'draft',
  context: { deficiencyFrom: null, deficiencyRounds: 0, recommendation: null },
  states: {
    draft: { on: { SUBMIT: 'submitted' } },
    submitted: { on: { INTAKE: 'document_scrutiny' } },
    document_scrutiny: {
      on: {
        PASS_SCRUTINY: 'compliance_check',
        RAISE_DEFICIENCY: raise('document_scrutiny'),
        REJECT: 'rejected',
      },
    },
    compliance_check: {
      on: {
        CLEAR_COMPLIANCE: { guard: 'complianceClear', target: 'committee_review' },
        RAISE_DEFICIENCY: raise('compliance_check'),
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
        RESUBMIT: [
          { guard: { type: 'returnTo', params: { stage: 'document_scrutiny' } }, target: 'document_scrutiny' },
          { guard: { type: 'returnTo', params: { stage: 'compliance_check' } }, target: 'compliance_check' },
          { guard: { type: 'returnTo', params: { stage: 'committee_review' } }, target: 'committee_review' },
          { guard: { type: 'returnTo', params: { stage: 'decision' } }, target: 'decision' },
        ],
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
  { key: 'pass', event: 'PASS_SCRUTINY', label: 'Documents verified: move to compliance', tone: 'primary', roles: ['officer', 'admin'], requiresNote: false },
  { key: 'clear', event: 'CLEAR_COMPLIANCE', label: 'Compliance cleared: send to committee', tone: 'primary', roles: ['officer', 'admin'], requiresNote: false },
  { key: 'rec_approve', event: 'RECOMMEND', label: 'Recommend approval', tone: 'primary', roles: ['committee', 'admin'], requiresNote: true, payload: { outcome: 'approve' } },
  { key: 'rec_reject', event: 'RECOMMEND', label: 'Recommend rejection', tone: 'danger', roles: ['committee', 'admin'], requiresNote: true, payload: { outcome: 'reject' } },
  { key: 'approve', event: 'APPROVE', label: 'Approve', tone: 'primary', roles: ['admin'], requiresNote: false },
  { key: 'reject', event: 'REJECT', label: 'Reject', tone: 'danger', roles: ['officer', 'admin'], requiresNote: true },
  { key: 'deficiency', event: 'RAISE_DEFICIENCY', label: 'Raise deficiency', tone: 'warning', roles: ['officer', 'committee', 'admin'], requiresNote: true },
];
