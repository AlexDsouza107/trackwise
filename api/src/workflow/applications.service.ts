import { createHash } from 'node:crypto';
import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { AiClient } from '../ai/ai.client';
import { NotificationsService } from '../alerts/notifications.service';
import { ApplicationType, AuthUser, REQUIRED_DOCUMENTS, Role, TYPE_LABELS } from '../common/types';
import { Metrics } from '../compliance/engine';
import { ComplianceService, periodOf } from '../compliance/compliance.service';
import { DbService } from '../db/db.service';
import { StorageService } from '../storage/storage.service';
import {
  ACTIONS, ActionDef, AppContext, AppEvent, AppState, canSend, FINAL_STATES, Persisted, send, SLA_HOURS,
} from './machine';

const HOUR = 3_600_000;
export const SYSTEM_ACTOR: AuthUser = { id: 0, name: 'TrackWise System', email: 'system@trackwise.local', role: 'admin', institutionId: null };

const num = z.coerce.number().nonnegative();
export const DETAIL_SCHEMAS: Record<ApplicationType, z.ZodTypeAny> = {
  new_institution: z.object({
    programmes: z.string().min(1), proposedIntake: num, facultyCount: num, studentCount: num,
    builtUpSqm: num, labCount: num, annualFee: num, accreditationValidUntil: z.string().optional(),
  }).passthrough(),
  new_course: z.object({ courseName: z.string().min(1), level: z.string().min(1), intake: num }).passthrough(),
  intake_increase: z.object({
    courseName: z.string().min(1), currentIntake: num, proposedIntake: num, justification: z.string().min(1),
  }).passthrough(),
  extension_of_approval: z.object({ academicYear: z.string().min(1), yearsRequested: z.coerce.number().int().min(1).max(5) }).passthrough(),
};

export const CreateDto = z.object({
  type: z.enum(['new_institution', 'new_course', 'intake_increase', 'extension_of_approval']),
  title: z.string().min(3).max(200),
  details: z.record(z.string(), z.unknown()),
});

export interface ApplicationRow {
  id: number; reference: string; institution_id: number; type: ApplicationType; title: string;
  details: Record<string, any>; state: AppState; context: AppContext; stage_entered_at: Date; sla_due_at: Date | null;
  risk_score: string | null; risk_level: string | null; risk_factors: unknown; doc_check: any; compliance: any;
  submitted_at: Date | null; decided_at: Date | null; created_by: number | null; created_at: Date; updated_at: Date;
}

/** Roles that own a queue state. */
const STATE_OWNERS: Partial<Record<AppState, Role>> = {
  submitted: 'officer', document_scrutiny: 'officer', compliance_check: 'officer',
  committee_review: 'committee', decision: 'admin',
};
const QUEUE_STATES: Record<Role, AppState[]> = {
  institution: ['draft', 'deficiency'],
  officer: ['submitted', 'document_scrutiny', 'compliance_check'],
  committee: ['committee_review'],
  admin: ['decision'],
};

const label = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

@Injectable()
export class ApplicationsService {
  private readonly log = new Logger('Applications');

  constructor(
    private readonly db: DbService,
    private readonly storage: StorageService,
    private readonly ai: AiClient,
    private readonly compliance: ComplianceService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---------- reads ----------

  async list(user: AuthUser, scope: 'mine' | 'queue' | 'all', state?: string) {
    const params: unknown[] = [];
    const where: string[] = [];
    if (user.role === 'institution') {
      params.push(user.institutionId);
      where.push(`a.institution_id = $${params.length}`);
    } else if (scope === 'queue') {
      params.push(QUEUE_STATES[user.role]);
      where.push(`a.state = any($${params.length})`);
    } else {
      where.push(`a.state <> 'draft'`);
    }
    if (state) {
      params.push(state);
      where.push(`a.state = $${params.length}`);
    }
    return this.db.query(
      `select a.id, a.reference, a.type, a.title, a.state, a.stage_entered_at, a.sla_due_at, a.risk_score, a.risk_level,
              a.submitted_at, a.decided_at, a.context->>'deficiencyRounds' as deficiency_rounds,
              i.name as institution_name, i.city,
              case when a.sla_due_at is null then null else extract(epoch from (a.sla_due_at - now()))/3600 end as sla_hours_left
         from applications a join institutions i on i.id = a.institution_id
        where ${where.join(' and ')}
        order by (a.state in ('approved','rejected')), a.sla_due_at asc nulls last, a.id desc limit 300`,
      params,
    );
  }

  async get(user: AuthUser, id: number) {
    const app = await this.row(id);
    if (user.role === 'institution' && user.institutionId !== app.institution_id) throw new ForbiddenException();
    const [institution, documents, audit] = await Promise.all([
      this.db.one('select id, name, code, city, state, approval_valid_until from institutions where id=$1', [app.institution_id]),
      this.db.query('select id, doc_type, filename, content_type, size_bytes, uploaded_at from documents where application_id=$1 order by id', [id]),
      this.db.query('select * from audit_log where application_id=$1 order by id', [id]),
    ]);
    return {
      ...app,
      typeLabel: TYPE_LABELS[app.type],
      institution,
      documents,
      audit,
      requiredDocuments: REQUIRED_DOCUMENTS[app.type],
      availableActions: this.availableActions(app, user),
    };
  }

  availableActions(app: ApplicationRow, user: AuthUser) {
    if (user.role === 'institution' && user.institutionId !== app.institution_id) return [];
    const p: Persisted = { state: app.state, context: app.context };
    return ACTIONS.filter((a) => a.roles.includes(user.role))
      .filter((a) => canSend(p, this.buildEvent(a, app)))
      .map((a) => ({ key: a.key, label: a.label, tone: a.tone, requiresNote: a.requiresNote }));
  }

  private async row(id: number): Promise<ApplicationRow> {
    const app = await this.db.one<ApplicationRow>('select * from applications where id=$1', [id]);
    if (!app) throw new NotFoundException('Application not found');
    return app;
  }

  // ---------- writes ----------

  async create(user: AuthUser, input: z.infer<typeof CreateDto>, at = new Date()) {
    if (user.role !== 'institution' || !user.institutionId) throw new ForbiddenException('Only institution users can apply');
    const parsed = DETAIL_SCHEMAS[input.type].safeParse(input.details);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    const row = await this.db.one<{ id: number }>(
      `insert into applications (reference, institution_id, type, title, details, state, context, stage_entered_at, created_by, created_at, updated_at)
       values ('pending', $1,$2,$3,$4,'draft',$5,$6,$7,$6,$6) returning id`,
      [user.institutionId, input.type, input.title, JSON.stringify(parsed.data),
        JSON.stringify({ deficiencyFrom: null, deficiencyRounds: 0, recommendation: null } satisfies AppContext), at, user.id],
    );
    const id = row!.id;
    await this.db.query('update applications set reference=$2 where id=$1', [id, `TW-${at.getFullYear()}-${String(id).padStart(4, '0')}`]);
    await this.audit(id, 'CREATED', null, 'draft', user, 'Draft created', at);
    return this.row(id);
  }

  async uploadDocument(
    user: AuthUser, id: number, file: { docType: string; filename: string; contentType: string; buffer: Buffer }, at = new Date(),
  ) {
    const app = await this.row(id);
    if (user.role !== 'institution' || user.institutionId !== app.institution_id) throw new ForbiddenException();
    if (app.state !== 'draft' && app.state !== 'deficiency') throw new BadRequestException('Documents can only be changed while in draft or deficiency');
    if (!REQUIRED_DOCUMENTS[app.type].includes(file.docType) && file.docType !== 'other') {
      throw new BadRequestException(`Unknown document type "${file.docType}" for ${app.type}`);
    }
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const key = `applications/${id}/${Date.now()}-${file.filename.replace(/[^\w.-]/g, '_')}`;
    await this.storage.put(key, file.buffer, file.contentType);
    const doc = await this.db.one(
      `insert into documents (application_id, doc_type, filename, content_type, size_bytes, sha256, storage_key, uploaded_by, uploaded_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id, doc_type, filename, size_bytes`,
      [id, file.docType, file.filename, file.contentType, file.buffer.length, sha256, key, user.id, at],
    );
    await this.audit(id, 'DOCUMENT_UPLOADED', app.state, app.state, user, `${label(file.docType)}: ${file.filename}`, at);
    await this.refresh(id);
    return doc;
  }

  async download(user: AuthUser, appId: number, docId: number) {
    const app = await this.row(appId);
    if (user.role === 'institution' && user.institutionId !== app.institution_id) throw new ForbiddenException();
    const doc = await this.db.one<{ filename: string; content_type: string; storage_key: string }>(
      'select filename, content_type, storage_key from documents where id=$1 and application_id=$2', [docId, appId]);
    if (!doc) throw new NotFoundException('Document not found');
    return { ...doc, buffer: await this.storage.get(doc.storage_key) };
  }

  private buildEvent(def: ActionDef, app: ApplicationRow): AppEvent {
    if (def.event === 'CLEAR_COMPLIANCE') {
      return { type: 'CLEAR_COMPLIANCE', criticalFailures: Number(app.compliance?.criticalFailures ?? 0) };
    }
    return { type: def.event, ...(def.payload ?? {}) } as AppEvent;
  }

  /** Entry point for user-driven actions: checks role, ownership and note requirements. */
  async act(user: AuthUser, id: number, key: string, note?: string, at = new Date()) {
    const def = ACTIONS.find((a) => a.key === key);
    if (!def) throw new BadRequestException(`Unknown action "${key}"`);
    const app = await this.row(id);
    if (!def.roles.includes(user.role)) throw new ForbiddenException('Your role cannot perform this action');
    if (user.role === 'institution' && user.institutionId !== app.institution_id) throw new ForbiddenException();
    if (def.requiresNote && !note?.trim()) throw new BadRequestException('A note is required for this action');
    if (def.event === 'CLEAR_COMPLIANCE' && Number(app.compliance?.criticalFailures ?? 0) > 0) {
      throw new BadRequestException('Critical compliance failures block clearance. Raise a deficiency instead.');
    }
    // Missing documents do not block SUBMIT: the AI check flags them and scrutiny can raise a deficiency.
    return this.dispatch(id, this.buildEvent(def, app), user, note, at);
  }

  /** Applies an event atomically, audit-logs it, then runs entry side effects (which may chain further events). */
  async dispatch(id: number, event: AppEvent, actor: AuthUser, note?: string, at = new Date()): Promise<ApplicationRow> {
    const { app, from } = await this.db.tx(async (c) => {
      const cur = (await c.query<ApplicationRow>('select * from applications where id=$1 for update', [id])).rows[0];
      if (!cur) throw new NotFoundException('Application not found');
      const next = send({ state: cur.state, context: cur.context }, event);
      if (!next) throw new BadRequestException(`Event ${event.type} is not allowed in state "${cur.state}"`);
      const hours = SLA_HOURS[next.state];
      const due = hours ? new Date(at.getTime() + hours * HOUR) : null;
      const final = FINAL_STATES.includes(next.state);
      const updated = (await c.query<ApplicationRow>(
        `update applications set state=$2, context=$3, stage_entered_at=$4, sla_due_at=$5, updated_at=$4,
                submitted_at = case when $6 then $4 else submitted_at end,
                decided_at = case when $7 then $4 else decided_at end
          where id=$1 returning *`,
        [id, next.state, JSON.stringify(next.context), at, due, event.type === 'SUBMIT' && !cur.submitted_at, final],
      )).rows[0];
      await c.query(
        `insert into audit_log (application_id, event, from_state, to_state, actor_id, actor_name, actor_role, note, meta, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [id, event.type, cur.state, next.state, actor.id || null, actor.name, actor.role, note ?? null,
          JSON.stringify(event.type === 'RECOMMEND' ? { outcome: event.outcome } : {}), at],
      );
      return { app: updated, from: cur.state };
    });
    return this.onEnter(app, from, actor, note, at);
  }

  private async onEnter(app: ApplicationRow, from: AppState, actor: AuthUser, note: string | undefined, at: Date): Promise<ApplicationRow> {
    const link = `/applications/${app.id}`;
    const stage = label(app.state);
    // Tell the institution about every move (except the internal submitted -> scrutiny hop).
    if (app.state !== 'document_scrutiny' || from !== 'submitted') {
      await this.notifications.notifyInstitution(app.institution_id, {
        kind: 'STATUS_CHANGE', title: `${app.reference}: ${stage}`, link, severity: app.state === 'deficiency' ? 'warning' : 'info',
        body: `${app.title} moved from ${label(from)} to ${stage}.${note && app.state === 'deficiency' ? ` Reason: ${note}` : ''}`,
        email: ['deficiency', 'approved', 'rejected'].includes(app.state),
      });
    }
    const owner = STATE_OWNERS[app.state];
    if (owner && app.state !== 'submitted') {
      await this.notifications.notifyRole(owner, {
        kind: 'QUEUE', title: `New in your queue: ${app.reference}`, link,
        body: `${app.title} is now in ${stage} (SLA ${SLA_HOURS[app.state]}h).`,
      });
    }

    switch (app.state) {
      case 'submitted':
        await this.captureProposedMetrics(app, at);
        await this.refresh(app.id);
        return this.dispatch(app.id, { type: 'INTAKE' }, SYSTEM_ACTOR, 'Automatic intake after AI document check', at);
      case 'document_scrutiny':
      case 'compliance_check':
        await this.refresh(app.id);
        break;
      case 'approved':
        await this.grantApproval(app, at);
        break;
      default:
        break;
    }
    return this.row(app.id);
  }

  private async captureProposedMetrics(app: ApplicationRow, at: Date) {
    if (app.type !== 'new_institution') return;
    const d = app.details;
    await this.compliance.saveMetrics(app.institution_id, periodOf(at), {
      facultyCount: Number(d.facultyCount), studentCount: Number(d.studentCount), builtUpSqm: Number(d.builtUpSqm),
      labCount: Number(d.labCount), annualFee: Number(d.annualFee), accreditationValidUntil: d.accreditationValidUntil ?? null,
    });
  }

  private async grantApproval(app: ApplicationRow, at: Date) {
    const years = app.type === 'extension_of_approval' ? Number(app.details.yearsRequested ?? 1) : 1;
    await this.db.query(
      `update institutions set status='active',
              approval_valid_until = (greatest(coalesce(approval_valid_until, $2::date), $2::date) + make_interval(years => $3))::date
        where id=$1`, [app.institution_id, at, years]);
  }

  /** Re-runs compliance what-if, AI document check and AI risk score, and stores the results on the application. */
  async refresh(id: number): Promise<void> {
    const app = await this.row(id);
    const rules = await this.compliance.rules();
    const adjust = (m: Metrics): Metrics =>
      app.type === 'intake_increase'
        ? { ...m, studentCount: m.studentCount + Math.max(0, Number(app.details.proposedIntake) - Number(app.details.currentIntake)) }
        : m;
    const evalResult = await this.compliance.evaluateWhatIf(app.institution_id, adjust);
    const compliance = evalResult
      ? {
          score: evalResult.score, criticalFailures: evalResult.criticalFailures, outcomes: evalResult.outcomes,
          metrics: evalResult.metrics, evaluatedAt: new Date().toISOString(),
          note: app.type === 'intake_increase' ? 'Projected with the additional intake added to current enrolment.' : undefined,
        }
      : null;

    const docs = await this.db.query<{ doc_type: string; filename: string; size_bytes: number; sha256: string; content_type: string }>(
      'select doc_type, filename, size_bytes, sha256, content_type from documents where application_id=$1', [id]);
    const required = REQUIRED_DOCUMENTS[app.type];
    const docCheck = await this.ai.checkDocuments({ application_type: app.type, required_types: required, documents: docs });
    const missingCount = docCheck?.missing.length ?? required.filter((t) => !docs.some((d) => d.doc_type === t)).length;

    const m = evalResult?.metrics;
    const feeCap = Number(rules.find((r) => r.code === 'fee_norms')?.params.maxAnnualFee ?? 0);
    const accDays = m?.accreditationValidUntil ? Math.floor((new Date(m.accreditationValidUntil).getTime() - Date.now()) / 86_400_000) : null;
    const d = app.details;
    const risk = await this.ai.scoreRisk({
      application_type: app.type,
      intake_increase_pct: app.type === 'intake_increase' && Number(d.currentIntake) > 0
        ? ((Number(d.proposedIntake) - Number(d.currentIntake)) / Number(d.currentIntake)) * 100 : null,
      student_faculty_ratio: m && m.facultyCount > 0 ? m.studentCount / m.facultyCount : null,
      compliance_score: compliance?.score ?? null,
      missing_documents: missingCount,
      prior_deficiencies: app.context.deficiencyRounds,
      fee_to_cap_ratio: m && feeCap ? m.annualFee / feeCap : null,
      accreditation_days_left: accDays,
    });

    await this.db.query(
      `update applications set compliance=$2, doc_check=$3, risk_score=$4, risk_level=$5, risk_factors=$6 where id=$1`,
      [id, JSON.stringify(compliance), JSON.stringify(docCheck), risk?.risk_score ?? null, risk?.level ?? null,
        JSON.stringify(risk ? { factors: risk.factors, modelVersion: risk.model_version } : null)],
    );
  }

  private async audit(id: number, event: string, from: string | null, to: string | null, actor: AuthUser, note: string | null, at: Date) {
    await this.db.query(
      `insert into audit_log (application_id, event, from_state, to_state, actor_id, actor_name, actor_role, note, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, event, from, to, actor.id || null, actor.name, actor.role, note, at]);
  }
}
