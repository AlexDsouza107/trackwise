import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { AuthUser } from '../common/types';
import { ApplicationsService } from '../workflow/applications.service';
import { STATE_LABELS } from '../workflow/machine';
import { VALIDITY_KINDS, statusOf } from '../validity/validity.service';

const pretty = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
const stamp = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '-');
const day = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : '-');

type View = Awaited<ReturnType<ApplicationsService['get']>>;
export interface LetterItem { label: string; detail: string }

/**
 * Standardised communications: a deficiency letter and an electronic case summary, both generated from the data already in the
 * system (audit trail, document check, compliance results, EVC report, document validity). Nothing here is hand-typed.
 */
@Injectable()
export class LettersService {
  constructor(private readonly apps: ApplicationsService) {}

  /** What currently needs fixing, gathered from every automated check. */
  private findings(v: View): LetterItem[] {
    const items: LetterItem[] = [];
    const check = v.doc_check as { missing?: string[]; findings?: { severity: string; message: string; code: string }[] } | null;
    for (const t of check?.missing ?? []) items.push({ label: `Missing document: ${pretty(t)}`, detail: 'Upload this document with the application.' });
    for (const f of check?.findings ?? []) {
      if (f.code === 'MISSING_DOCUMENT' || f.severity === 'info') continue;
      items.push({ label: `Document check (${f.severity})`, detail: f.message });
    }
    const comp = v.compliance as { outcomes?: { ruleCode: string; passed: boolean; detail: string }[] } | null;
    for (const o of comp?.outcomes ?? []) {
      if (!o.passed) items.push({ label: `Compliance: ${pretty(o.ruleCode)}`, detail: o.detail });
    }
    if (v.evc?.report && v.evc.report.outcome !== 'satisfactory') {
      items.push({ label: `Expert visit: ${pretty(v.evc.report.outcome)}`, detail: v.evc.report.findings });
    }
    for (const d of v.validity as { kind: string; valid_until: Date; renewal_pending: boolean }[]) {
      const st = statusOf(d.valid_until, d.renewal_pending);
      if (st === 'expired') items.push({ label: `Expired document: ${VALIDITY_KINDS[d.kind] ?? d.kind}`, detail: `Expired on ${day(d.valid_until)}. Submit a renewal.` });
    }
    return items;
  }

  /** Suggested reason text for the officer to edit before raising a deficiency. */
  async draftDeficiencyNote(user: AuthUser, id: number): Promise<{ note: string; items: LetterItem[] }> {
    if (user.role === 'institution') throw new ForbiddenException();
    const v = await this.apps.get(user, id);
    const items = this.findings(v);
    const note = items.length
      ? `Please address the following before this application can proceed: ${items.map((i, n) => `(${n + 1}) ${i.label} - ${i.detail}`).join(' ')}`
      : 'Please review the application and provide the clarifications requested.';
    return { note: note.slice(0, 1900), items };
  }

  async deficiencyLetter(user: AuthUser, id: number) {
    const v = await this.apps.get(user, id);
    const raised = v.audit.filter((a: any) => a.event === 'RAISE_DEFICIENCY');
    if (!raised.length) throw new BadRequestException('No deficiency has been raised on this application');
    const last = raised[raised.length - 1] as any;
    const inst = v.institution as any;
    const round = raised.length;
    return {
      reference: `${v.reference}/DEF-${round}`,
      issuedOn: last.created_at as Date,
      application: { reference: v.reference, title: v.title, type: v.typeLabel },
      to: { name: inst.name as string, city: inst.city as string, state: inst.state as string },
      subject: `Deficiencies in application ${v.reference}: ${v.title}`,
      intro: `Your application was reviewed at the stage "${STATE_LABELS[last.from_state as keyof typeof STATE_LABELS] ?? pretty(last.from_state)}" and cannot proceed until the points below are resolved.`,
      reason: last.note as string,
      items: v.state === 'deficiency' ? this.findings(v) : [],
      dueBy: v.state === 'deficiency' ? (v.sla_due_at as Date | null) : null,
      instructions: [
        'Open the application in TrackWise and upload the missing or corrected documents (one file per document type).',
        'Add a note describing what was corrected and choose "Resubmit with corrections".',
        'The application will return to the stage that raised the deficiency; the time limit shown above applies.',
      ],
      issuedBy: { name: last.actor_name as string, role: pretty(last.actor_role as string) },
      round, status: v.state === 'deficiency' ? 'open' : 'resolved',
    };
  }

  async caseSummary(user: AuthUser, id: number) {
    const v = await this.apps.get(user, id);
    const inst = v.institution as any;
    const final = v.audit.filter((a: any) => ['approved', 'rejected'].includes(a.to_state) && a.from_state !== a.to_state).at(-1) as any;
    const risk = (v.risk_factors as { factors?: { label: string; points: number; detail: string }[] } | null)?.factors ?? [];
    const comp = v.compliance as { score?: number; criticalFailures?: number; outcomes?: { ruleCode: string; passed: boolean; detail: string }[] } | null;
    return {
      generatedAt: new Date(),
      application: {
        reference: v.reference, title: v.title, type: v.typeLabel, state: STATE_LABELS[v.state as keyof typeof STATE_LABELS],
        submittedAt: v.submitted_at as Date | null, decidedAt: v.decided_at as Date | null, deficiencyRounds: v.context.deficiencyRounds,
        slaDueAt: v.sla_due_at as Date | null,
      },
      institution: { name: inst.name as string, code: inst.code as string, city: inst.city as string, state: inst.state as string, region: inst.region as string | null },
      route: (v.route as string[]).map((s) => STATE_LABELS[s as keyof typeof STATE_LABELS] ?? pretty(s)),
      timeline: v.audit.filter((a: any) => a.from_state !== a.to_state || !['CREATED'].includes(a.event)).map((a: any) => ({
        at: a.created_at as Date, event: pretty(a.event), from: a.from_state as string | null, to: a.to_state as string | null,
        actor: a.actor_name as string, role: a.actor_role as string, note: a.note as string | null,
      })),
      documents: v.documents.map((d: any) => ({ type: pretty(d.doc_type), filename: d.filename as string, source: d.source as string, uploadedAt: d.uploaded_at as Date })),
      missingDocuments: ((v.doc_check as { missing?: string[] } | null)?.missing ?? []).map(pretty),
      ai: v.risk_score === null ? null : { score: Number(v.risk_score), level: v.risk_level as string, factors: risk },
      compliance: comp ? { score: comp.score ?? null, criticalFailures: comp.criticalFailures ?? 0, outcomes: comp.outcomes ?? [] } : null,
      evc: v.evc ? {
        status: v.evc.status, scheduledFor: v.evc.scheduled_for, venue: v.evc.venue, members: v.evc.members.map((m) => m.name), report: v.evc.report,
      } : null,
      documentValidity: (v.validity as { kind: string; valid_until: Date; renewal_pending: boolean }[]).map((d) => ({
        kind: VALIDITY_KINDS[d.kind] ?? d.kind, validUntil: day(d.valid_until), status: statusOf(d.valid_until, d.renewal_pending),
      })),
      outcome: final ? { result: final.to_state as string, at: final.created_at as Date, by: final.actor_name as string, note: final.note as string | null } : null,
    };
  }

  // ---------- PDF rendering ----------

  private render(build: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Producer: 'TrackWise' } });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      build(doc);
      doc.end();
    });
  }

  private header(doc: PDFKit.PDFDocument, title: string, reference: string) {
    doc.rect(0, 0, doc.page.width, 64).fill('#0b3d91');
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(18).text('TrackWise', 50, 22);
    doc.font('Helvetica').fontSize(9).text('Approval workflow automation (illustrative demo)', 50, 44);
    doc.fillColor('#1c1c1e').font('Helvetica-Bold').fontSize(15).text(title, 50, 86);
    doc.font('Helvetica').fontSize(9).fillColor('#6b6b73').text(reference, 50, 106);
    doc.moveDown(1.2).fillColor('#1c1c1e');
  }

  private h2(doc: PDFKit.PDFDocument, text: string) {
    doc.moveDown(0.8).font('Helvetica-Bold').fontSize(11).fillColor('#0b3d91').text(text).moveDown(0.3).font('Helvetica').fontSize(10).fillColor('#1c1c1e');
  }

  private footer(doc: PDFKit.PDFDocument, note: string) {
    doc.moveDown(1.5).font('Helvetica-Oblique').fontSize(8).fillColor('#6b6b73')
      .text(`${note} ILLUSTRATIVE DEMO DOCUMENT - not an official communication; all data is invented.`, { align: 'left' });
  }

  async deficiencyLetterPdf(user: AuthUser, id: number): Promise<Buffer> {
    const l = await this.deficiencyLetter(user, id);
    return this.render((doc) => {
      this.header(doc, 'Notice of deficiency', `Ref. ${l.reference}   |   Issued ${stamp(l.issuedOn)}`);
      doc.fontSize(10).text(`To: The Registrar, ${l.to.name}, ${l.to.city}, ${l.to.state}`);
      doc.moveDown(0.5).font('Helvetica-Bold').text(`Subject: ${l.subject}`).font('Helvetica');
      doc.moveDown(0.6).text(l.intro, { align: 'justify' });
      this.h2(doc, 'Reason recorded by the reviewer');
      doc.text(l.reason, { align: 'justify' });
      if (l.items.length) {
        this.h2(doc, 'Points to resolve');
        l.items.forEach((it, n) => doc.font('Helvetica-Bold').text(`${n + 1}. ${it.label}`).font('Helvetica').text(it.detail, { indent: 14 }).moveDown(0.2));
      }
      if (l.dueBy) { this.h2(doc, 'Time limit'); doc.text(`Please resubmit before ${stamp(l.dueBy)}. Delays are escalated automatically.`); }
      this.h2(doc, 'How to respond');
      l.instructions.forEach((t, n) => doc.text(`${n + 1}. ${t}`).moveDown(0.15));
      doc.moveDown(1).text(`Issued by: ${l.issuedBy.name}`);
      this.footer(doc, 'Auto-drafted by TrackWise from the review findings.');
    });
  }

  async caseSummaryPdf(user: AuthUser, id: number): Promise<Buffer> {
    const s = await this.caseSummary(user, id);
    return this.render((doc) => {
      this.header(doc, 'Electronic case summary', `${s.application.reference}   |   Generated ${stamp(s.generatedAt)}`);
      doc.fontSize(10);
      const kv = (k: string, v: string) => doc.font('Helvetica-Bold').text(`${k}: `, { continued: true }).font('Helvetica').text(v);
      kv('Application', `${s.application.title} (${s.application.type})`);
      kv('Institution', `${s.institution.name}, ${s.institution.city}, ${s.institution.state}${s.institution.region ? ` - ${s.institution.region} region` : ''}`);
      kv('Current status', s.application.state);
      kv('Route', ['Submitted', ...s.route, 'Decision'].join(' > '));
      kv('Submitted', stamp(s.application.submittedAt));
      if (s.application.slaDueAt) kv('Stage due', stamp(s.application.slaDueAt));
      kv('Deficiency rounds', String(s.application.deficiencyRounds));
      if (s.outcome) kv('Outcome', `${pretty(s.outcome.result)} on ${stamp(s.outcome.at)} by ${s.outcome.by}${s.outcome.note ? ` - ${s.outcome.note}` : ''}`);

      this.h2(doc, 'Timeline');
      s.timeline.forEach((t) => doc.text(`${stamp(t.at)}  ${t.event}${t.from && t.to && t.from !== t.to ? ` (${STATE_LABELS[t.from as keyof typeof STATE_LABELS] ?? t.from} > ${STATE_LABELS[t.to as keyof typeof STATE_LABELS] ?? t.to})` : ''} - ${t.actor}${t.note ? `: ${t.note}` : ''}`, { lineGap: 1 }));

      this.h2(doc, 'Documents');
      if (!s.documents.length) doc.text('None uploaded.');
      s.documents.forEach((d) => doc.text(`${d.type}: ${d.filename}${d.source !== 'upload' ? ` [${d.source}]` : ''}`));
      if (s.missingDocuments.length) doc.fillColor('#d93a3a').text(`Missing: ${s.missingDocuments.join(', ')}`).fillColor('#1c1c1e');

      if (s.compliance) {
        this.h2(doc, `Compliance (score ${s.compliance.score ?? '-'}, ${s.compliance.criticalFailures} critical failure(s))`);
        s.compliance.outcomes.forEach((o) => doc.text(`${o.passed ? 'PASS' : 'FAIL'}  ${pretty(o.ruleCode)} - ${o.detail}`));
      }
      if (s.evc) {
        this.h2(doc, 'Expert visit (EVC)');
        doc.text(`Status: ${pretty(s.evc.status)}${s.evc.scheduledFor ? `; visit ${stamp(s.evc.scheduledFor)} at ${s.evc.venue}` : ''}`);
        if (s.evc.members.length) doc.text(`Members: ${s.evc.members.join(', ')}`);
        if (s.evc.report) doc.text(`Report (${pretty(s.evc.report.outcome)}): ${s.evc.report.findings}`);
      }
      if (s.documentValidity.length) {
        this.h2(doc, 'Prescribed document validity');
        s.documentValidity.forEach((d) => doc.text(`${d.kind}: valid until ${d.validUntil} (${pretty(d.status)})`));
      }
      if (s.ai) {
        this.h2(doc, `AI assessment (bonus signal): risk ${s.ai.score} - ${pretty(s.ai.level)}`);
        s.ai.factors.forEach((f) => doc.text(`+${f.points}  ${f.label} - ${f.detail}`));
      }
      this.footer(doc, 'Generated from the live audit trail and checks.');
    });
  }
}
