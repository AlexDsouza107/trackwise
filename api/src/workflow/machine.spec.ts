import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applicationMachine, AppEvent, Persisted, send } from './machine';

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

test('happy path reaches approved', () => {
  const end = run([
    { type: 'SUBMIT' }, { type: 'INTAKE' }, { type: 'PASS_SCRUTINY' },
    { type: 'CLEAR_COMPLIANCE', criticalFailures: 0 },
    { type: 'RECOMMEND', outcome: 'approve' }, { type: 'APPROVE' },
  ]);
  assert.equal(end.state, 'approved');
  assert.equal(end.context.recommendation, 'approve');
});

test('critical compliance failures block clearance', () => {
  const at = run([{ type: 'SUBMIT' }, { type: 'INTAKE' }, { type: 'PASS_SCRUTINY' }]);
  assert.equal(send(at, { type: 'CLEAR_COMPLIANCE', criticalFailures: 1 }), null);
});

test('deficiency loop returns to the originating stage and counts rounds', () => {
  const at = run([{ type: 'SUBMIT' }, { type: 'INTAKE' }, { type: 'PASS_SCRUTINY' }]);
  const def = run([{ type: 'RAISE_DEFICIENCY' }], at);
  assert.equal(def.state, 'deficiency');
  assert.equal(def.context.deficiencyRounds, 1);
  assert.equal(run([{ type: 'RESUBMIT' }], def).state, 'compliance_check');
});

test('invalid transitions are rejected and final states are terminal', () => {
  assert.equal(send(start, { type: 'APPROVE' }), null);
  const done = run([{ type: 'SUBMIT' }, { type: 'INTAKE' }, { type: 'REJECT' }]);
  assert.equal(done.state, 'rejected');
  assert.equal(send(done, { type: 'APPROVE' }), null);
});
