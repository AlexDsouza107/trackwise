export type Severity = 'critical' | 'major' | 'minor';

export interface Metrics {
  facultyCount: number;
  studentCount: number;
  builtUpSqm: number;
  labCount: number;
  accreditationValidUntil: string | null; // ISO date
  annualFee: number;
}

export interface Rule {
  code: string;
  name: string;
  description: string;
  severity: Severity;
  weight: number;
  params: Record<string, number>;
}

export interface RuleOutcome {
  ruleCode: string;
  passed: boolean;
  score: number; // 0..1
  value: number | null;
  threshold: number | null;
  detail: string;
}

/** Illustrative norms only: NOT real AICTE figures. */
export const DEFAULT_RULES: Rule[] = [
  { code: 'faculty_ratio', name: 'Student:Faculty Ratio', severity: 'critical', weight: 3,
    description: 'Students per faculty member must not exceed the norm.', params: { maxRatio: 20 } },
  { code: 'infrastructure', name: 'Infrastructure', severity: 'major', weight: 2,
    description: 'Built-up area per student and minimum number of laboratories.', params: { minSqmPerStudent: 4, minLabs: 6 } },
  { code: 'accreditation', name: 'Accreditation Validity', severity: 'critical', weight: 3,
    description: 'Accreditation must be valid; warn when expiring within 180 days.', params: { warnDays: 180 } },
  { code: 'fee_norms', name: 'Fee Norms', severity: 'major', weight: 2,
    description: 'Annual tuition fee must not exceed the cap.', params: { maxAnnualFee: 180000 } },
];

const DAY = 86_400_000;

export function daysUntil(isoDate: string | null, now: Date): number | null {
  if (!isoDate) return null;
  return Math.floor((new Date(isoDate).getTime() - now.getTime()) / DAY);
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export function evaluateRule(rule: Rule, m: Metrics, now: Date): RuleOutcome {
  switch (rule.code) {
    case 'faculty_ratio': {
      const ratio = m.facultyCount > 0 ? m.studentCount / m.facultyCount : Infinity;
      const max = rule.params.maxRatio;
      const passed = ratio <= max;
      return { ruleCode: rule.code, passed, score: passed ? 1 : clamp01(1 - (ratio - max) / max),
        value: Number.isFinite(ratio) ? round(ratio) : null, threshold: max,
        detail: `${round(ratio)}:1 against a maximum of ${max}:1` };
    }
    case 'infrastructure': {
      const sqm = m.studentCount > 0 ? m.builtUpSqm / m.studentCount : Infinity;
      const { minSqmPerStudent, minLabs } = rule.params;
      const areaScore = clamp01(sqm / minSqmPerStudent);
      const labScore = clamp01(m.labCount / minLabs);
      const score = (areaScore + labScore) / 2;
      const passed = sqm >= minSqmPerStudent && m.labCount >= minLabs;
      return { ruleCode: rule.code, passed, score, value: round(sqm), threshold: minSqmPerStudent,
        detail: `${round(sqm)} sqm/student (min ${minSqmPerStudent}), ${m.labCount} labs (min ${minLabs})` };
    }
    case 'accreditation': {
      const days = daysUntil(m.accreditationValidUntil, now);
      const warn = rule.params.warnDays;
      if (days === null || days < 0) {
        return { ruleCode: rule.code, passed: false, score: 0, value: days, threshold: 0,
          detail: days === null ? 'No accreditation on record' : `Accreditation lapsed ${-days} day(s) ago` };
      }
      return { ruleCode: rule.code, passed: true, score: days >= warn ? 1 : 0.5, value: days, threshold: warn,
        detail: days >= warn ? `Valid for ${days} more day(s)` : `Expiring soon: ${days} day(s) left` };
    }
    case 'fee_norms': {
      const cap = rule.params.maxAnnualFee;
      const passed = m.annualFee <= cap;
      return { ruleCode: rule.code, passed, score: passed ? 1 : clamp01(1 - ((m.annualFee - cap) / cap) * 2),
        value: m.annualFee, threshold: cap, detail: `Fee ${m.annualFee} against cap ${cap}` };
    }
    default:
      return { ruleCode: rule.code, passed: true, score: 1, value: null, threshold: null, detail: 'Unknown rule skipped' };
  }
}

export function evaluateAll(rules: Rule[], m: Metrics, now: Date) {
  const outcomes = rules.map((r) => evaluateRule(r, m, now));
  const totalWeight = rules.reduce((s, r) => s + r.weight, 0);
  const weighted = rules.reduce((s, r, i) => s + r.weight * outcomes[i].score, 0);
  const score = totalWeight ? round((weighted / totalWeight) * 100) : 100;
  const criticalFailures = rules.filter((r, i) => r.severity === 'critical' && !outcomes[i].passed).length;
  return { score, outcomes, criticalFailures };
}

function round(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : n;
}
