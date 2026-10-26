import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { REQUIRED_DOCUMENTS, ApplicationType, Role } from '../common/types';
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
 *  - APPROVAL_EXPIRING: hours *before* the approval expires
 * `notify_role` may be 'stage_owner' (role responsible for the application's current stage) or 'institution'.
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
];

const STAGE_OWNER: Record<string, Role> = {
  submitted: 'officer',
  document_scrutiny: 'officer',
  compliance_check: 'officer',
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

  async scan(now = new Date()): Promise<{ sla: number; expiring: number; missingDocs: number }> {
    const rules = await this.db.query<EscalationRule>('select * from escalation_rules where enabled order by kind, level');
    const byKind = (k: string) => rules.filter((r) => r.kind === k);
    const result = {
      sla: await this.scanSla(byKind('SLA_BREACH'), now),
      expiring: await this.scanExpiring(byKind('APPROVAL_EXPIRING'), now),
      missingDocs: await this.scanMissingDocs(byKind('MISSING_DOCUMENTS'), now),
    };
    this.log.log(`Scan complete: ${JSON.stringify(result)}`);
    return result;
  }

  /** Records the alert once per dedupe key and notifies; returns true if newly raised. */
  private async raise(rule: EscalationRule, a: {
    entityType: string; entityId: number; message: string; dedupeKey: string; title: string; link: string;
    role: Role | 'institution'; institutionId: number;
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
    else await this.notifications.notifyRole(a.role, n);
    return true;
  }

  private async scanSla(rules: EscalationRule[], now: Date): Promise<number> {
    const apps = await this.db.query<{ id: number; reference: string; title: string; state: string; institution_id: number; sla_due_at: Date }>(
      `select id, reference, title, state, institution_id, sla_due_at from applications
        where state not in ('draft','approved','rejected') and sla_due_at < $1`, [now]);
    let raised = 0;
    for (const app of apps) {
      const overdue = (now.getTime() - app.sla_due_at.getTime()) / HOUR;
      for (const rule of rules.filter((r) => Number(r.after_hours) <= overdue)) {
        const msg = `${app.reference} (${app.title}) is ${Math.floor(overdue)}h past its SLA in stage "${app.state}".`;
        const role = rule.notify_role === 'stage_owner' ? (STAGE_OWNER[app.state] ?? 'institution') : (rule.notify_role as Role);
        const ok = await this.raise(rule, { entityType: 'application', entityId: app.id, message: msg,
          dedupeKey: `sla:${app.id}:${app.state}:${rule.level}`, title: `SLA breach: ${app.reference}`,
          link: `/applications/${app.id}`, role, institutionId: app.institution_id });
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
}
