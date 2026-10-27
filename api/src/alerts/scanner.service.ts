import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { REQUIRED_DOCUMENTS, ApplicationType, Role } from '../common/types';
import { VALIDITY_KINDS } from '../validity/validity.service';
import { NotificationsService } from './notifications.service';
import { QueueService } from './queue.service';

interface EscalationRule {
  id: number;
  kind: string;
  level: number;
  after_hours: string;
  notify_role: string;
  email: boolean;
  enabled: boolean;
}

type Severity = 'warning' | 'critical';

/**
 * Default escalation ladder. `after_hours` means:
 *  - SLA_BREACH: hours past the SLA due time
 *  - MISSING_DOCUMENTS: hours the application has waited in its current stage
 *  - APPROVAL_EXPIRING / DOCUMENT_EXPIRING: hours *before* the approval or document expires (0 = on expiry)
 *  - EVC_UNSCHEDULED: hours an application has waited in the EVC stage with no visit scheduled
 *  - EVC_VISIT_REMINDER: hours *before* a scheduled visit
 *  - EVC_REPORT_OVERDUE: hours after the visit date with no report filed
 * `notify_role` may be 'stage_owner' (role responsible for the application's current stage), 'institution',
 * 'evc_members' (the committee members assigned to the visit) or any role; 'regional' is limited to the entity's region.
 */
const DEFAULT_ESCALATIONS = [
  { kind: 'SLA_BREACH', level: 1, after_hours: 0, notify_role: 'stage_owner', email: false },
  { kind: 'SLA_BREACH', level: 2, after_hours: 24, notify_role: 'admin', email: true },
  { kind: 'SLA_BREACH', level: 3, after_hours: 72, notify_role: 'admin', email: true },
  { kind: 'APPROVAL_EXPIRING', level: 1, after_hours: 2160, notify_role: 'institution', email: false },
  { kind: 'APPROVAL_EXPIRING', level: 2, after_hours: 720, notify_role: 'institution', email: true },
  { kind: 'APPROVAL_EXPIRING', level: 3, after_hours: 720, notify_role: 'admin', email: false },
  { kind: 'MISSING_DOCUMENTS', level: 1, after_hours: 24, notify_role: 'institution', email: false },
  { kind: 'MISSING_DOCUMENTS', level: 2, after_hours: 96, notify_role: 'institution', email: true },
  { kind: 'MISSING_DOCUMENTS', level: 3, after_hours: 168, notify_role: 'officer', email: false },
  { kind: 'DOCUMENT_EXPIRING', level: 1, after_hours: 2160, notify_role: 'institution', email: false },
  { kind: 'DOCUMENT_EXPIRING', level: 2, after_hours: 720, notify_role: 'institution', email: true },
  { kind: 'DOCUMENT_EXPIRING', level: 3, after_hours: 168, notify_role: 'regional', email: false },
  { kind: 'DOCUMENT_EXPIRING', level: 4, after_hours: 0, notify_role: 'officer', email: true },
  { kind: 'EVC_UNSCHEDULED', level: 1, after_hours: 48, notify_role: 'regional', email: false },
  { kind: 'EVC_UNSCHEDULED', level: 2, after_hours: 96, notify_role: 'admin', email: true },
  { kind: 'EVC_UNSCHEDULED', level: 3, after_hours: 168, notify_role: 'admin', email: true },
  { kind: 'EVC_VISIT_REMINDER', level: 1, after_hours: 72, notify_role: 'institution', email: false },
  { kind: 'EVC_VISIT_REMINDER', level: 2, after_hours: 24, notify_role: 'evc_members', email: true },
  { kind: 'EVC_REPORT_OVERDUE', level: 1, after_hours: 24, notify_role: 'evc_members', email: false },
  { kind: 'EVC_REPORT_OVERDUE', level: 2, after_hours: 72, notify_role: 'regional', email: true },
  { kind: 'EVC_REPORT_OVERDUE', level: 3, after_hours: 120, notify_role: 'admin', email: true },
];

const STAGE_OWNER: Record<string, Role> = {
  submitted: 'officer',
  document_scrutiny: 'officer',
  compliance_check: 'officer',
  evc_visit: 'regional',
  committee_review: 'committee',
  decision: 'admin',
};

const HOUR = 3_600_000;
const severityFor = (level: number): Severity => (level >= 2 ? 'critical' : 'warning');

@Injectable()
export class ScannerService implements OnModuleInit {
  private readonly log = new Logger('AlertScanner');

  constructor(
    private readonly db: DbService,
    private readonly notifications: NotificationsService,
    private readonly queues: QueueService,
  ) {}

  async onModuleInit(): Promise<void> {
    for (const r of DEFAULT_ESCALATIONS) {
      await this.db.query(
        `insert into escalation_rules (kind, level, after_hours, notify_role, email)
         values ($1,$2,$3,$4,$5) on conflict (kind, level) do nothing`,
        [r.kind, r.level, r.after_hours, r.notify_role, r.email],
      );
    }
    this.queues.setScanHandler(() => this.scan());
  }

  async scan(now = new Date()): Promise<{ sla: number; expiring: number; missingDocs: number; documents: number; evc: number }> {
    const rules = await this.db.query<EscalationRule>('select * from escalation_rules where enabled order by kind, level');
    const byKind = (k: string) => rules.filter((r) => r.kind === k);
    const result = {
      sla: await this.scanSla(byKind('SLA_BREACH'), now),
      expiring: await this.scanExpiring(byKind('APPROVAL_EXPIRING'), now),
      missingDocs: await this.scanMissingDocs(byKind('MISSING_DOCUMENTS'), now),
      documents: await this.scanDocumentValidity(byKind('DOCUMENT_EXPIRING'), now),
      evc: await this.scanEvc(rules, now),
    };
    this.log.log(`Scan complete: ${JSON.stringify(result)}`);
    return result;
  }

  /** Records the alert once per dedupe key and notifies; returns true if newly raised. */
  private async raise(rule: EscalationRule, a: {
    entityType: string; entityId: number; message: string; dedupeKey: string; title: string; link: string;
    role: Role | 'institution' | 'evc_members'; institutionId: number; region?: string | null; userIds?: number[];
  }): Promise<boolean> {
    const severity = severityFor(rule.level);
    const row = await this.db.one(
      `insert into alerts (kind, level, severity, entity_type, entity_id, message, dedupe_key)
       values ($1,$2,$3,$4,$5,$6,$7) on conflict (dedupe_key) do nothing returning id`,
      [rule.kind, rule.level, severity, a.entityType, a.entityId, a.message, a.dedupeKey],
    );
    if (!row) return false;
    const n = { kind: rule.kind, severity, title: a.title, body: a.message, link: a.link, dedupeKey: a.dedupeKey, email: rule.email };
    if (a.role === 'institution') await this.notifications.notifyInstitution(a.institutionId, n);
    else if (a.role === 'evc_members') await this.notifications.notifyUsers(a.userIds ?? [], n);
    else await this.notifications.notifyRole(a.role, n, a.role === 'regional' ? a.region : null);
    return true;
  }

  private async scanSla(rules: EscalationRule[], now: Date): Promise<number> {
    const apps = await this.db.query<{ id: number; reference: string; title: string; state: string; institution_id: number; sla_due_at: Date; region: string | null }>(
      `select a.id, a.reference, a.title, a.state, a.institution_id, a.sla_due_at, i.region
         from applications a join institutions i on i.id = a.institution_id
        where a.state not in ('draft','approved','rejected') and a.sla_due_at < $1`, [now]);
    let raised = 0;
    for (const app of apps) {
      const overdue = (now.getTime() - app.sla_due_at.getTime()) / HOUR;
      for (const rule of rules.filter((r) => Number(r.after_hours) <= overdue)) {
        const msg = `${app.reference} (${app.title}) is ${Math.floor(overdue)}h past its SLA in stage "${app.state}".`;
        const role = rule.notify_role === 'stage_owner' ? (STAGE_OWNER[app.state] ?? 'institution') : (rule.notify_role as Role);
        const ok = await this.raise(rule, { entityType: 'application', entityId: app.id, message: msg,
          dedupeKey: `sla:${app.id}:${app.state}:${rule.level}`, title: `SLA breach: ${app.reference}`,
          link: `/applications/${app.id}`, role, institutionId: app.institution_id, region: app.region });
        if (ok) raised++;
      }
    }
    return raised;
  }

  private async scanExpiring(rules: EscalationRule[], now: Date): Promise<number> {
    const insts = await this.db.query<{ id: number; name: string; approval_valid_until: Date }>(
      'select id, name, approval_valid_until from institutions where approval_valid_until is not null');
    let raised = 0;
    for (const inst of insts) {
      const hoursLeft = (inst.approval_valid_until.getTime() - now.getTime()) / HOUR;
      const day = inst.approval_valid_until.toISOString().slice(0, 10);
      for (const rule of rules.filter((r) => hoursLeft <= Number(r.after_hours))) {
        const msg = hoursLeft < 0
          ? `Approval of ${inst.name} expired on ${day}.`
          : `Approval of ${inst.name} expires on ${day} (${Math.ceil(hoursLeft / 24)} day(s) left).`;
        const ok = await this.raise(rule, { entityType: 'institution', entityId: inst.id, message: msg,
          dedupeKey: `expiring:${inst.id}:${day}:${rule.level}`, title: 'Approval expiring',
          link: '/compliance', role: rule.notify_role as Role, institutionId: inst.id });
        if (ok) raised++;
      }
    }
    return raised;
  }

  private async scanMissingDocs(rules: EscalationRule[], now: Date): Promise<number> {
    const apps = await this.db.query<{ id: number; reference: string; type: ApplicationType; state: string; institution_id: number; stage_entered_at: Date; uploaded: string[] }>(
      `select a.id, a.reference, a.type, a.state, a.institution_id, a.stage_entered_at,
              coalesce(array_agg(distinct d.doc_type) filter (where d.doc_type is not null), '{}') as uploaded
         from applications a left join documents d on d.application_id = a.id
        where a.state in ('draft','deficiency') group by a.id`);
    let raised = 0;
    for (const app of apps) {
      const missing = REQUIRED_DOCUMENTS[app.type].filter((t) => !app.uploaded.includes(t));
      if (!missing.length) continue;
      const waiting = (now.getTime() - app.stage_entered_at.getTime()) / HOUR;
      for (const rule of rules.filter((r) => Number(r.after_hours) <= waiting)) {
        const msg = `${app.reference} is missing ${missing.length} document(s): ${missing.join(', ')}.`;
        const ok = await this.raise(rule, { entityType: 'application', entityId: app.id, message: msg,
          dedupeKey: `missing:${app.id}:${app.state}:${rule.level}`, title: `Missing documents: ${app.reference}`,
          link: `/applications/${app.id}`, role: rule.notify_role as Role, institutionId: app.institution_id });
        if (ok) raised++;
      }
    }
    return raised;
  }

  private async scanDocumentValidity(rules: EscalationRule[], now: Date): Promise<number> {
    const docs = await this.db.query<{ id: number; kind: string; institution_id: number; valid_until: Date; name: string; region: string | null }>(
      `select d.id, d.kind, d.institution_id, d.valid_until, i.name, i.region
         from institution_documents d join institutions i on i.id = d.institution_id
        where d.renewal is null`); // a renewal awaiting verification pauses reminders; the verifier is notified instead
    let raised = 0;
    for (const d of docs) {
      const hoursLeft = (d.valid_until.getTime() - now.getTime()) / HOUR;
      const day = d.valid_until.toISOString().slice(0, 10);
      const label = VALIDITY_KINDS[d.kind] ?? d.kind;
      for (const rule of rules.filter((r) => hoursLeft <= Number(r.after_hours))) {
        const msg = hoursLeft < 0
          ? `${label} of ${d.name} expired on ${day}. Submit a renewal.`
          : `${label} of ${d.name} expires on ${day} (${Math.ceil(hoursLeft / 24)} day(s) left).`;
        const ok = await this.raise(rule, { entityType: 'document', entityId: d.id, message: msg,
          dedupeKey: `docexp:${d.id}:${day}:${rule.level}`, title: `${label} ${hoursLeft < 0 ? 'expired' : 'expiring'}`,
          link: '/documents', role: rule.notify_role as Role, institutionId: d.institution_id, region: d.region });
        if (ok) raised++;
      }
    }
    return raised;
  }

  private async scanEvc(rules: EscalationRule[], now: Date): Promise<number> {
    const visits = await this.db.query<{
      id: number; round: number; status: string; scheduled_for: Date | null; member_ids: number[]; application_id: number;
      reference: string; title: string; institution_id: number; stage_entered_at: Date; region: string | null; name: string;
    }>(
      `select v.id, v.round, v.status, v.scheduled_for, v.member_ids, a.id as application_id, a.reference, a.title, a.institution_id,
              a.stage_entered_at, i.region, i.name
         from evc_visits v join applications a on a.id = v.application_id join institutions i on i.id = a.institution_id
        where a.state = 'evc_visit' and v.status <> 'completed'`);
    let raised = 0;
    const link = (v: { application_id: number }) => `/applications/${v.application_id}`;
    for (const v of visits) {
      const base = { entityType: 'application', entityId: v.application_id, institutionId: v.institution_id, region: v.region, userIds: v.member_ids, link: link(v) };
      if (v.status === 'awaiting_schedule') {
        const waiting = (now.getTime() - v.stage_entered_at.getTime()) / HOUR;
        for (const rule of rules.filter((r) => r.kind === 'EVC_UNSCHEDULED' && Number(r.after_hours) <= waiting)) {
          const ok = await this.raise(rule, { ...base, role: rule.notify_role as Role,
            message: `${v.reference} (${v.name}) has waited ${Math.floor(waiting)}h for its EVC visit to be scheduled.`,
            dedupeKey: `evcunsched:${v.id}:${v.round}:${rule.level}`, title: `EVC visit not scheduled: ${v.reference}` });
          if (ok) raised++;
        }
      } else if (v.scheduled_for) {
        const hoursTo = (v.scheduled_for.getTime() - now.getTime()) / HOUR;
        const stamp = v.scheduled_for.getTime();
        if (hoursTo >= 0) {
          for (const rule of rules.filter((r) => r.kind === 'EVC_VISIT_REMINDER' && hoursTo <= Number(r.after_hours))) {
            const ok = await this.raise(rule, { ...base, role: rule.notify_role as Role,
              message: `EVC visit to ${v.name} for ${v.reference} is in ${Math.max(1, Math.ceil(hoursTo))}h (${v.scheduled_for.toISOString().slice(0, 16).replace('T', ' ')} UTC).`,
              dedupeKey: `evcrem:${v.id}:${v.round}:${stamp}:${rule.level}`, title: `EVC visit reminder: ${v.reference}` });
            if (ok) raised++;
          }
        } else {
          for (const rule of rules.filter((r) => r.kind === 'EVC_REPORT_OVERDUE' && -hoursTo >= Number(r.after_hours))) {
            const ok = await this.raise(rule, { ...base, role: rule.notify_role as Role,
              message: `The EVC report for ${v.reference} (${v.name}) is ${Math.floor(-hoursTo)}h overdue.`,
              dedupeKey: `evcrep:${v.id}:${v.round}:${stamp}:${rule.level}`, title: `EVC report overdue: ${v.reference}` });
            if (ok) raised++;
          }
        }
      }
    }
    return raised;
  }
}
