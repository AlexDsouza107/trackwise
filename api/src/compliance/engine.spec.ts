import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_RULES, evaluateAll, Metrics } from './engine';

const now = new Date('2026-06-01');
const good: Metrics = { facultyCount: 100, studentCount: 1500, builtUpSqm: 9000, labCount: 10,
  accreditationValidUntil: '2027-06-01', annualFee: 120000 };

test('compliant institution scores 100 with no critical failures', () => {
  const r = evaluateAll(DEFAULT_RULES, good, now);
  assert.equal(r.score, 100);
  assert.equal(r.criticalFailures, 0);
});

test('bad ratio and lapsed accreditation are critical failures and lower the score', () => {
  const r = evaluateAll(DEFAULT_RULES, { ...good, facultyCount: 50, accreditationValidUntil: '2026-01-01' }, now);
  assert.equal(r.criticalFailures, 2);
  assert.ok(r.score < 60);
});

test('expiring accreditation passes with partial credit', () => {
  const r = evaluateAll(DEFAULT_RULES, { ...good, accreditationValidUntil: '2026-07-01' }, now);
  const acc = r.outcomes.find((o) => o.ruleCode === 'accreditation')!;
  assert.ok(acc.passed && acc.score === 0.5);
});
