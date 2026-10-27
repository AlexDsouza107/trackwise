import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { DbService } from '../db/db.service';
import { DEFAULT_RULES, evaluateAll, Metrics, Rule } from './engine';

interface MetricsRow {
  faculty_count: number;
  student_count: number;
  built_up_sqm: number;
  lab_count: number;
  accreditation_valid_until: Date | null;
  annual_fee: number;
  period: Date;
}

const PARAM_SCHEMAS: Record<string, z.ZodTypeAny> = {
  faculty_ratio: z.object({ maxRatio: z.number().positive() }).strict(),
  infrastructure: z.object({ minSqmPerStudent: z.number().positive(), minLabs: z.number().int().min(0) }).strict(),
  accreditation: z.object({ warnDays: z.number().int().min(0) }).strict(),
  fee_norms: z.object({ maxAnnualFee: z.number().positive() }).strict(),
};
export const RulePatchDto = z.object({
  weight: z.number().positive().max(10).optional(),
  severity: z.enum(['critical', 'major', 'minor']).optional(),
  params: z.record(z.string(), z.number()).optional(),
});

export const periodOf = (d: Date): string => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;

const toMetrics = (r: MetricsRow): Metrics => ({
  facultyCount: r.faculty_count,
  studentCount: r.student_count,
  builtUpSqm: r.built_up_sqm,
  labCount: r.lab_count,
  accreditationValidUntil: r.accreditation_valid_until ? r.accreditation_valid_until.toISOString().slice(0, 10) : null,
  annualFee: r.annual_fee,
});

@Injectable()
export class ComplianceService implements OnModuleInit {
  constructor(private readonly db: DbService) {}

  async onModuleInit(): Promise<void> {
    for (const r of DEFAULT_RULES) {
      await this.db.query(
        `insert into compliance_rules (code, name, description, severity, weight, params)
         values ($1,$2,$3,$4,$5,$6) on conflict (code) do nothing`,
        [r.code, r.name, r.description, r.severity, r.weight, JSON.stringify(r.params)],
      );
    }
  }

  async rules(): Promise<Rule[]> {
    const rows = await this.db.query<Rule & { weight: string }>('select * from compliance_rules order by code');
    return rows.map((r) => ({ ...r, weight: Number(r.weight) }));
  }

  async updateRule(code: string, patch: z.infer<typeof RulePatchDto>): Promise<Rule> {
    const rule = (await this.rules()).find((r) => r.code === code);
    if (!rule) throw new NotFoundException('Unknown rule');
    let params = rule.params;
    if (patch.params) {
      const parsed = PARAM_SCHEMAS[code]?.safeParse(patch.params);
      if (!parsed?.success) throw new BadRequestException(`Invalid parameters for ${code}: ${parsed?.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
      params = parsed.data;
    }
    await this.db.query('update compliance_rules set weight=$2, severity=$3, params=$4 where code=$1',
      [code, patch.weight ?? rule.weight, patch.severity ?? rule.severity, JSON.stringify(params)]);
    return (await this.rules()).find((r) => r.code === code)!;
  }

  /** Re-evaluates every active institution on its latest metrics (used after rule thresholds change). */
  async evaluateAllActive(): Promise<number> {
    const ids = await this.db.query<{ id: number }>("select id from institutions where status='active' order by id");
    let n = 0;
    for (const { id } of ids) {
      try { await this.evaluateInstitution(id); n++; } catch { /* no metrics recorded */ }
    }
    return n;
  }

  async latestMetrics(institutionId: number): Promise<{ metrics: Metrics; period: string } | null> {
    const row = await this.db.one<MetricsRow>(
      'select * from institution_metrics where institution_id=$1 order by period desc limit 1', [institutionId]);
    return row ? { metrics: toMetrics(row), period: periodOf(row.period) } : null;
  }

  async saveMetrics(institutionId: number, period: string, m: Metrics): Promise<void> {
    await this.db.query(
      `insert into institution_metrics (institution_id, period, faculty_count, student_count, built_up_sqm, lab_count, accreditation_valid_until, annual_fee)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (institution_id, period) do update set faculty_count=$3, student_count=$4, built_up_sqm=$5,
         lab_count=$6, accreditation_valid_until=$7, annual_fee=$8`,
      [institutionId, period, m.facultyCount, m.studentCount, m.builtUpSqm, m.labCount, m.accreditationValidUntil, m.annualFee],
    );
  }

  /** Evaluates and persists results for one institution/period. */
  async evaluateInstitution(institutionId: number, period?: string, now = new Date()) {
    const row = period
      ? await this.db.one<MetricsRow>('select * from institution_metrics where institution_id=$1 and period=$2', [institutionId, period])
      : await this.db.one<MetricsRow>('select * from institution_metrics where institution_id=$1 order by period desc limit 1', [institutionId]);
    if (!row) throw new NotFoundException('No metrics recorded for this institution');
    const rules = await this.rules();
    const evalResult = evaluateAll(rules, toMetrics(row), now);
    const p = periodOf(row.period);
    for (const o of evalResult.outcomes) {
      await this.db.query(
        `insert into compliance_results (institution_id, period, rule_code, passed, score, value, threshold, detail, evaluated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,now())
         on conflict (institution_id, period, rule_code) do update set passed=$4, score=$5, value=$6, threshold=$7, detail=$8, evaluated_at=now()`,
        [institutionId, p, o.ruleCode, o.passed, o.score, o.value, o.threshold, o.detail],
      );
    }
    await this.db.query(
      `insert into compliance_scores (institution_id, period, score) values ($1,$2,$3)
       on conflict (institution_id, period) do update set score=$3`, [institutionId, p, evalResult.score]);
    return { period: p, ...evalResult };
  }

  /** Read-only what-if evaluation used while an application is in the compliance stage. */
  async evaluateWhatIf(institutionId: number, adjust: (m: Metrics) => Metrics, now = new Date()) {
    const latest = await this.latestMetrics(institutionId);
    if (!latest) return null;
    const rules = await this.rules();
    const metrics = adjust(latest.metrics);
    return { metrics, ...evaluateAll(rules, metrics, now) };
  }

  async overview(region?: string | null) {
    const rules = await this.rules();
    const institutions = await this.db.query<{ id: number; name: string; city: string; state: string; region: string | null; code: string; approval_valid_until: Date | null }>(
      'select id, name, city, state, region, code, approval_valid_until from institutions where status=\'active\' and ($1::text is null or region=$1) order by name',
      [region ?? null]);
    const scores = await this.db.query<{ institution_id: number; period: Date; score: string }>(
      'select institution_id, period, score from compliance_scores order by period');
    const results = await this.db.query<{ institution_id: number; period: Date; rule_code: string; passed: boolean; score: string; detail: string }>(
      `select distinct on (institution_id, rule_code) institution_id, period, rule_code, passed, score, detail
         from compliance_results order by institution_id, rule_code, period desc`);
    return {
      rules: rules.map((r) => ({ code: r.code, name: r.name, severity: r.severity })),
      institutions: institutions.map((i) => {
        const series = scores.filter((s) => s.institution_id === i.id);
        const last = series.at(-1);
        const prev = series.at(-2);
        return {
          ...i,
          score: last ? Number(last.score) : null,
          delta: last && prev ? Number(last.score) - Number(prev.score) : null,
          results: Object.fromEntries(
            results.filter((r) => r.institution_id === i.id).map((r) => [r.rule_code, { passed: r.passed, score: Number(r.score), detail: r.detail }]),
          ),
        };
      }),
    };
  }

  async detail(institutionId: number) {
    const inst = await this.db.one('select * from institutions where id=$1', [institutionId]);
    if (!inst) throw new NotFoundException('Institution not found');
    const trend = await this.db.query<{ period: Date; score: string }>(
      'select period, score from compliance_scores where institution_id=$1 order by period', [institutionId]);
    const latestPeriod = trend.at(-1)?.period;
    const results = latestPeriod
      ? await this.db.query(
          `select r.*, cr.name, cr.severity from compliance_results r join compliance_rules cr on cr.code=r.rule_code
            where r.institution_id=$1 and r.period=$2 order by cr.code`, [institutionId, latestPeriod])
      : [];
    const metrics = await this.db.query('select * from institution_metrics where institution_id=$1 order by period', [institutionId]);
    return {
      institution: inst,
      trend: trend.map((t) => ({ period: periodOf(t.period), score: Number(t.score) })),
      results,
      metrics,
    };
  }
}
