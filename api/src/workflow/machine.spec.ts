import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applicationMachine, AppEvent, DEFAULT_ROUTES, nextStage, normaliseRoute, Persisted, ReviewStage, send } from './machine';

const start: Persisted = { state: 'draft', context: applicationMachine.config.context as Persisted['context'] };

function run(events: AppEvent[], from = start): Persisted {
  let cur = from;
  for (const e of events) {
    const next = send(cur, e);
    assert.ok(next, `event ${e.type} should be allowed from ${cur.state}`);
    cur = next;
  }
  return cur;
}

const submitted = (route: ReviewStage[]) => run([{ type: 'SUBMIT', route }, { type: 'INTAKE' }]);
const states = (route: ReviewStage[], events: AppEvent[]): string[] => {
  const seen: string[] = [];
  let cur = start;
  for (const e of events) { cur = run([e], cur); seen.push(cur.state); }
  void route;
  return seen;
};

test('full route reaches approved through every stage', () => {
  const route: ReviewStage[] = ['document_scrutiny', 'compliance_check', 'evc_visit', 'committee_review'];
  const end = run([
    { type: 'SUBMIT', route }, { type: 'INTAKE' }, { type: 'PASS_SCRUTINY' },
    { type: 'CLEAR_COMPLIANCE', criticalFailures: 0 }, { type: 'COMPLETE_EVC', reportFiled: true },
    { type: 'RECOMMEND', outcome: 'approve' }, { type: 'APPROVE' },
  ]);
  assert.equal(end.state, 'approved');
  assert.equal(end.context.recommendation, 'approve');
});

test('routes decide the path: scrutiny only, scrutiny + EVC, EVC only', () => {
  assert.deepEqual(states(['document_scrutiny'], [{ type: 'SUBMIT', route: ['document_scrutiny'] }, { type: 'INTAKE' }, { type: 'PASS_SCRUTINY' }]),
    ['submitted', 'document_scrutiny', 'decision']);
  assert.deepEqual(states([], [{ type: 'SUBMIT', route: ['document_scrutiny', 'evc_visit'] }, { type: 'INTAKE' }, { type: 'PASS_SCRUTINY' }, { type: 'COMPLETE_EVC', reportFiled: true }]),
    ['submitted', 'document_scrutiny', 'evc_visit', 'decision']);
  assert.deepEqual(states([], [{ type: 'SUBMIT', route: ['evc_visit'] }, { type: 'INTAKE' }]), ['submitted', 'evc_visit']);
});

test('a stage outside the route cannot be entered or acted on', () => {
  const at = submitted(['document_scrutiny', 'committee_review']);
  assert.equal(at.state, 'document_scrutiny');
  const next = run([{ type: 'PASS_SCRUTINY' }], at);
  assert.equal(next.state, 'committee_review', 'compliance and EVC are skipped');
  assert.equal(send(at, { type: 'CLEAR_COMPLIANCE', criticalFailures: 0 }), null);
  assert.equal(send(at, { type: 'COMPLETE_EVC', reportFiled: true }), null);
});

test('critical compliance failures block clearance', () => {
  const at = run([{ type: 'SUBMIT', route: DEFAULT_ROUTES.new_course }, { type: 'INTAKE' }, { type: 'PASS_SCRUTINY' }]);
  assert.equal(at.state, 'compliance_check');
  assert.equal(send(at, { type: 'CLEAR_COMPLIANCE', criticalFailures: 1 }), null);
});

test('the EVC stage needs a filed report', () => {
  const at = run([{ type: 'SUBMIT', route: ['evc_visit'] }, { type: 'INTAKE' }]);
  assert.equal(send(at, { type: 'COMPLETE_EVC', reportFiled: false }), null);
  assert.equal(send(at, { type: 'COMPLETE_EVC', reportFiled: true })?.state, 'decision');
});

test('deficiency loop returns to the originating stage (including EVC) and counts rounds', () => {
  const at = run([{ type: 'SUBMIT', route: DEFAULT_ROUTES.new_institution }, { type: 'INTAKE' }, { type: 'PASS_SCRUTINY' }]);
  const def = run([{ type: 'RAISE_DEFICIENCY' }], at);
  assert.equal(def.state, 'deficiency');
  assert.equal(def.context.deficiencyRounds, 1);
  assert.equal(run([{ type: 'RESUBMIT' }], def).state, 'compliance_check');

  const atEvc = run([{ type: 'CLEAR_COMPLIANCE', criticalFailures: 0 }], at);
  assert.equal(atEvc.state, 'evc_visit');
  assert.equal(run([{ type: 'RAISE_DEFICIENCY' }, { type: 'RESUBMIT' }], atEvc).state, 'evc_visit');
});

test('invalid transitions are rejected and final states are terminal', () => {
  assert.equal(send(start, { type: 'APPROVE' }), null);
  const done = run([{ type: 'SUBMIT' }, { type: 'INTAKE' }, { type: 'REJECT' }]);
  assert.equal(done.state, 'rejected');
  assert.equal(send(done, { type: 'APPROVE' }), null);
});

test('route helpers: canonical order, validation and lookahead', () => {
  assert.deepEqual(normaliseRoute(['committee_review', 'document_scrutiny', 'document_scrutiny', 'bogus']), ['document_scrutiny', 'committee_review']);
  assert.throws(() => normaliseRoute([]));
  assert.equal(nextStage(['document_scrutiny', 'evc_visit'], null), 'document_scrutiny');
  assert.equal(nextStage(['document_scrutiny', 'evc_visit'], 'document_scrutiny'), 'evc_visit');
  assert.equal(nextStage(['document_scrutiny', 'evc_visit'], 'evc_visit'), 'decision');
});
