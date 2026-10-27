/**
 * End-to-end API test against a real Postgres and the real AI service.
 * MinIO and Redis/BullMQ are replaced by in-memory fakes so the suite runs without Docker.
 *
 *   DATABASE_URL=postgres://... AI_URL=http://localhost:8000 npm run test:e2e
 */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { INestApplication } from '@nestjs/common';

process.env.SEED_DEMO_DATA = 'true';
process.env.JWT_SECRET = 'test-secret';

/* eslint-disable @typescript-eslint/no-require-imports */
const { Test } = require('@nestjs/testing') as typeof import('@nestjs/testing');
const { AppModule } = require('../src/app.module') as typeof import('../src/app.module');
const { StorageService } = require('../src/storage/storage.service') as typeof import('../src/storage/storage.service');
const { QueueService } = require('../src/alerts/queue.service') as typeof import('../src/alerts/queue.service');

const files = new Map<string, { body: Buffer; type: string }>();
const fakeStorage = {
  onModuleInit: async () => undefined,
  put: async (k: string, body: Buffer, type: string) => void files.set(k, { body, type }),
  get: async (k: string) => files.get(k)!.body,
  delete: async (k: string) => void files.delete(k),
};
const emailJobs: unknown[] = [];
const fakeQueues = {
  email: { add: async (_n: string, data: unknown) => void emailJobs.push(data) },
  scan: {},
  setScanHandler: () => undefined,
  onModuleInit: async () => undefined,
  onModuleDestroy: async () => undefined,
};

let app: INestApplication;
let base = '';
const tokens: Record<string, string> = {};

async function call<T = any>(method: string, path: string, who?: string, body?: unknown): Promise<{ status: number; body: T }> {
  const headers: Record<string, string> = {};
  if (who) headers.authorization = `Bearer ${tokens[who]}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
}

async function login(key: string, email: string) {
  tokens[key] = (await call('POST', '/auth/login', undefined, { email, password: 'demo1234' })).body.token;
}

async function postForm<T = any>(path: string, who: string, fields: Record<string, string>, fileName = 'doc.pdf'): Promise<{ status: number; body: T }> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append('file', new Blob([Buffer.alloc(900, fileName)], { type: 'application/pdf' }), fileName);
  const res = await fetch(base + path, { method: 'POST', headers: { authorization: `Bearer ${tokens[who]}` }, body: form });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
}

async function upload(appId: number, who: string, docType: string) {
  const form = new FormData();
  form.append('docType', docType);
  form.append('file', new Blob([Buffer.alloc(900, docType)], { type: 'application/pdf' }), `${docType}.pdf`);
  const res = await fetch(`${base}/applications/${appId}/documents`, { method: 'POST', headers: { authorization: `Bearer ${tokens[who]}` }, body: form });
  assert.equal(res.status, 201, await res.clone().text());
}

before(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(StorageService).useValue(fakeStorage)
    .overrideProvider(QueueService).useValue(fakeQueues)
    .compile();
  app = mod.createNestApplication();
  await app.listen(0);
  base = (await app.getUrl()).replace('[::1]', 'localhost');
  await login('inst', 'inst01@trackwise.demo');
  await login('inst2', 'inst02@trackwise.demo');
  await login('officer', 'officer1@trackwise.demo');
  await login('committee', 'committee1@trackwise.demo');
  await login('admin', 'admin@trackwise.demo');
  await login('committee2', 'committee2@trackwise.demo');
  await login('regW', 'regional4@trackwise.demo'); // Western
  await login('regN', 'regional1@trackwise.demo'); // Northern
  await login('inst3', 'inst03@trackwise.demo');
});

after(async () => {
  await app.close();
});

const newCourse = (title: string) => ({
  type: 'new_course', title, details: { courseName: 'B.Tech Quantum Computing', level: 'UG', intake: 30 },
});
const REQUIRED = ['application_form', 'faculty_list', 'lab_inventory', 'curriculum', 'fee_structure'];

describe('seed', () => {
  test('is populated with applications across stages and documents in storage', async () => {
    const { body } = await call('GET', '/health');
    assert.ok(body.applications >= 20);
    assert.ok(files.size > 50);
    const all = await call<any[]>('GET', '/applications?scope=all', 'admin');
    const states = new Set(all.body.map((a) => a.state));
    for (const s of ['document_scrutiny', 'compliance_check', 'evc_visit', 'committee_review', 'decision', 'deficiency', 'approved', 'rejected']) {
      assert.ok(states.has(s), `seed should include state ${s}`);
    }
  });

  test('officer queue only holds officer stages and is ordered by SLA urgency', async () => {
    const q = (await call<any[]>('GET', '/applications?scope=queue', 'officer')).body;
    assert.ok(q.length > 3);
    assert.ok(q.every((a) => ['submitted', 'document_scrutiny', 'compliance_check'].includes(a.state)));
    const hours = q.map((a) => Number(a.sla_hours_left));
    assert.deepEqual(hours, [...hours].sort((a, b) => a - b));
    assert.ok(hours[0] < 0, 'most urgent item should already be breached');
  });
});

describe('workflow', () => {
  test('happy path: draft -> approved with a full audit trail', async () => {
    const created = (await call('POST', '/applications', 'inst', newCourse('E2E happy path'))).body;
    assert.equal(created.state, 'draft');
    for (const d of REQUIRED) await upload(created.id, 'inst', d);

    let app1 = (await call('POST', `/applications/${created.id}/actions`, 'inst', { action: 'submit' })).body;
    assert.equal(app1.state, 'document_scrutiny', 'submit auto-advances through intake');
    assert.equal(app1.doc_check.missing.length, 0);
    assert.ok(app1.risk_level, 'AI risk score stored');
    assert.deepEqual(app1.availableActions.map((a: any) => a.key).sort(), []);

    const officerView = (await call('GET', `/applications/${created.id}`, 'officer')).body;
    assert.deepEqual(officerView.availableActions.map((a: any) => a.key).sort(), ['deficiency', 'pass', 'reject']);

    app1 = (await call('POST', `/applications/${created.id}/actions`, 'officer', { action: 'pass' })).body;
    assert.equal(app1.state, 'compliance_check');
    assert.ok(app1.compliance.score > 0);

    app1 = (await call('POST', `/applications/${created.id}/actions`, 'officer', { action: 'clear' })).body;
    assert.equal(app1.state, 'committee_review');

    app1 = (await call('POST', `/applications/${created.id}/actions`, 'committee', { action: 'rec_approve', note: 'Looks good' })).body;
    assert.equal(app1.state, 'decision');
    assert.equal(app1.context.recommendation, 'approve');

    app1 = (await call('POST', `/applications/${created.id}/actions`, 'admin', { action: 'approve' })).body;
    assert.equal(app1.state, 'approved');
    assert.equal(app1.sla_due_at, null);

    const trail = app1.audit.filter((a: any) => a.from_state && a.from_state !== a.to_state).map((a: any) => `${a.from_state}>${a.to_state}`);
    assert.deepEqual(trail, [
      'draft>submitted', 'submitted>document_scrutiny', 'document_scrutiny>compliance_check', 'compliance_check>committee_review',
      'committee_review>decision', 'decision>approved',
    ]);
    assert.equal(app1.audit.filter((a: any) => a.event === 'DOCUMENT_UPLOADED').length, REQUIRED.length);
  });

  test('deficiency loop: note required, institution fixes and resubmits to the originating stage', async () => {
    const created = (await call('POST', '/applications', 'inst', newCourse('E2E deficiency loop'))).body;
    for (const d of REQUIRED.filter((d) => d !== 'curriculum')) await upload(created.id, 'inst', d);
    const submitted = (await call('POST', `/applications/${created.id}/actions`, 'inst', { action: 'submit' })).body;
    assert.deepEqual(submitted.doc_check.missing, ['curriculum']);
    assert.ok(submitted.doc_check.findings.some((f: any) => f.code === 'MISSING_DOCUMENT'));

    const noNote = await call('POST', `/applications/${created.id}/actions`, 'officer', { action: 'deficiency' });
    assert.equal(noNote.status, 400);

    const def = (await call('POST', `/applications/${created.id}/actions`, 'officer', { action: 'deficiency', note: 'Curriculum missing' })).body;
    assert.equal(def.state, 'deficiency');
    assert.equal(def.context.deficiencyRounds, 1);

    await upload(created.id, 'inst', 'curriculum');
    const back = (await call('POST', `/applications/${created.id}/actions`, 'inst', { action: 'resubmit', note: 'Curriculum attached' })).body;
    assert.equal(back.state, 'document_scrutiny');
    assert.equal(back.doc_check.missing.length, 0);
    assert.ok(back.audit.some((a: any) => a.event === 'RAISE_DEFICIENCY' && a.note === 'Curriculum missing'));
  });

  test('documents: one per type, removable, only while editable', async () => {
    const created = (await call('POST', '/applications', 'inst', newCourse('E2E documents'))).body;
    await upload(created.id, 'inst', 'curriculum');
    await upload(created.id, 'inst', 'curriculum'); // same type again replaces, never duplicates
    let view = (await call('GET', `/applications/${created.id}`, 'inst')).body;
    assert.equal(view.documents.length, 1);
    const stored = files.size;

    assert.equal((await call('DELETE', `/applications/${created.id}/documents/${view.documents[0].id}`, 'inst2')).status, 403);
    assert.equal((await call('DELETE', `/applications/${created.id}/documents/${view.documents[0].id}`, 'inst')).status, 200);
    view = (await call('GET', `/applications/${created.id}`, 'inst')).body;
    assert.equal(view.documents.length, 0);
    assert.equal(files.size, stored - 1, 'file removed from storage too');
    assert.ok(view.audit.some((a: any) => a.event === 'DOCUMENT_REMOVED'));
    assert.deepEqual(view.doc_check.missing.includes('curriculum'), true);

    // After submission, documents are locked.
    for (const d of REQUIRED) await upload(created.id, 'inst', d);
    const sub = (await call('POST', `/applications/${created.id}/actions`, 'inst', { action: 'submit' })).body;
    assert.equal((await call('DELETE', `/applications/${created.id}/documents/${sub.documents[0].id}`, 'inst')).status, 400);
  });

  test('critical compliance failures block clearance', async () => {
    const all = (await call<any[]>('GET', '/applications?scope=queue&state=compliance_check', 'officer')).body;
    const blocked = (await Promise.all(all.map((a) => call('GET', `/applications/${a.id}`, 'officer')))).map((r) => r.body)
      .find((a) => a.compliance?.criticalFailures > 0);
    assert.ok(blocked, 'seed should include an application with a critical compliance failure');
    const res = await call('POST', `/applications/${blocked.id}/actions`, 'officer', { action: 'clear' });
    assert.equal(res.status, 400);
    assert.match(res.body.message, /Critical compliance failures/);
  });
});

describe('access control', () => {
  test('roles and ownership are enforced', async () => {
    assert.equal((await call('GET', '/analytics/summary', 'inst')).status, 403);
    assert.equal((await call('GET', '/applications')).status, 401);
    const mine = (await call<any[]>('GET', '/applications', 'inst')).body;
    assert.ok(mine.length > 0);
    assert.equal((await call('GET', `/applications/${mine[0].id}`, 'inst2')).status, 403);
    const inQueue = (await call<any[]>('GET', '/applications?scope=queue', 'committee')).body[0];
    assert.equal((await call('POST', `/applications/${inQueue.id}/actions`, 'committee', { action: 'approve' })).status, 403);
    assert.equal((await call('POST', `/applications/${inQueue.id}/actions`, 'inst', { action: 'pass' })).status, 403);
  });

  test('documents download as real PDFs for staff', async () => {
    const all = (await call<any[]>('GET', '/applications?scope=all', 'officer')).body;
    const detail = (await call('GET', `/applications/${all[0].id}`, 'officer')).body;
    const res = await fetch(`${base}/applications/${detail.id}/documents/${detail.documents[0].id}/file`, { headers: { authorization: `Bearer ${tokens.officer}` } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/pdf');
    assert.equal((await res.text()).slice(0, 5), '%PDF-');
  });
});

describe('alerts, compliance and analytics', () => {
  test('scan is idempotent and covers all three alert kinds with escalation levels', async () => {
    const first = (await call('POST', '/alerts/scan', 'admin')).body;
    assert.deepEqual(first, { sla: 0, expiring: 0, missingDocs: 0, documents: 0, evc: 0 }, 'seed already scanned; nothing new');
    const alerts = (await call<any[]>('GET', '/alerts', 'admin')).body;
    const kinds = new Set(alerts.map((a) => a.kind));
    assert.deepEqual([...kinds].sort(), ['APPROVAL_EXPIRING', 'DOCUMENT_EXPIRING', 'EVC_REPORT_OVERDUE', 'EVC_UNSCHEDULED', 'EVC_VISIT_REMINDER', 'MISSING_DOCUMENTS', 'SLA_BREACH']);
    assert.ok(alerts.some((a) => a.kind === 'SLA_BREACH' && a.level >= 2), 'long-overdue items escalate to admin');
    const adminInbox = (await call('GET', '/notifications', 'admin')).body;
    assert.ok(adminInbox.unread > 0);
    assert.ok(emailJobs.length > 0, 'escalations/deficiency emails were queued');
    assert.equal((await call('GET', '/alerts', 'inst')).status, 403);
  });

  test('overview exposes heatmap data and the compliance trend has six periods', async () => {
    const ov = (await call('GET', '/compliance/overview', 'officer')).body;
    assert.equal(ov.rules.length, 4);
    assert.equal(ov.institutions.length, 12);
    const withFail = ov.institutions.filter((i: any) => Object.values<any>(i.results).some((r) => !r.passed));
    assert.ok(withFail.length >= 4);
    const detail = (await call('GET', `/compliance/institutions/${ov.institutions[0].id}`, 'officer')).body;
    assert.equal(detail.trend.length, 6);
    const months = detail.trend.map((t: any) => t.period);
    assert.equal(new Set(months).size, 6, 'distinct month periods (timezone-safe)');
    assert.equal((await call('GET', `/compliance/institutions/${ov.institutions[1].id}`, 'inst')).status, 403);
  });

  test('analytics summary is coherent', async () => {
    const s = (await call('GET', '/analytics/summary', 'admin')).body;
    assert.ok(s.totals.slaBreached > 0);
    assert.ok(s.avgTurnaroundHours > 0);
    assert.ok(s.pendingByState.length >= 5);
    assert.ok(s.alertVolume.length > 3);
    assert.equal(s.heatmap.institutions.length, 12);
  });
});


const intake = (title: string) => ({
  type: 'intake_increase', title,
  details: { courseName: 'B.Tech CSE', currentIntake: 60, proposedIntake: 66, justification: 'Modest expansion.' },
});
const INTAKE_DOCS = ['application_form', 'faculty_list', 'infrastructure_certificate', 'previous_approval_letter', 'fee_structure'];
const nextHour = () => new Date(Date.now() + 48 * 3_600_000).toISOString();

describe('routing and the Expert Visit Committee', () => {
  test('application types follow their configured route', async () => {
    const course = (await call('POST', '/applications', 'inst', newCourse('E2E route check'))).body;
    assert.deepEqual(course.context.route, ['document_scrutiny', 'compliance_check', 'committee_review']);
    const all = (await call<any[]>('GET', '/applications?scope=all', 'admin')).body;
    const ext = all.find((a) => a.type === 'extension_of_approval' && a.state === 'approved');
    const extDetail = (await call('GET', `/applications/${ext.id}`, 'admin')).body;
    const stages = extDetail.audit.filter((a: any) => a.from_state !== a.to_state && a.from_state).map((a: any) => a.to_state);
    assert.ok(!stages.includes('committee_review') && !stages.includes('evc_visit'), 'extensions skip committee and EVC');
  });

  test('intake increase: scrutiny > compliance > EVC (schedule, report, complete) > committee > decision', async () => {
    const created = (await call('POST', '/applications', 'inst', intake('E2E EVC flow'))).body;
    assert.ok(created.context.route.includes('evc_visit'));
    for (const d of INTAKE_DOCS) await upload(created.id, 'inst', d);
    await call('POST', `/applications/${created.id}/actions`, 'inst', { action: 'submit' });
    await call('POST', `/applications/${created.id}/actions`, 'officer', { action: 'pass' });
    let a = (await call('POST', `/applications/${created.id}/actions`, 'officer', { action: 'clear' })).body;
    assert.equal(a.state, 'evc_visit');
    assert.equal(a.evc.status, 'awaiting_schedule');
    assert.ok(a.sla_due_at, 'EVC stage has an SLA');

    const queue = (await call<any[]>('GET', '/applications?scope=queue', 'regW')).body;
    assert.ok(queue.some((q) => q.id === created.id), 'regional officer of the region sees it');
    assert.equal((await call<any[]>('GET', '/applications?scope=queue', 'regN')).body.some((q) => q.id === created.id), false, 'other regions do not');
    assert.equal((await call('GET', `/applications/${created.id}`, 'regN')).status, 403);

    const members = (await call<any[]>('GET', '/evc/members', 'regW')).body;
    const c1 = members.find((m) => m.name.includes('Banerjee')).id;
    assert.equal((await call('POST', `/applications/${created.id}/actions`, 'regW', { action: 'evc_complete', note: 'x' })).status, 400, 'cannot complete before a report');
    const past = await call('POST', `/applications/${created.id}/evc/schedule`, 'regW', { scheduledFor: '2020-01-01T10:00:00Z', venue: 'Campus', memberIds: [c1] });
    assert.equal(past.status, 400);
    assert.equal((await call('POST', `/applications/${created.id}/evc/schedule`, 'regN', { scheduledFor: nextHour(), venue: 'Campus', memberIds: [c1] })).status, 403);
    assert.equal((await call('POST', `/applications/${created.id}/evc/schedule`, 'officer', { scheduledFor: nextHour(), venue: 'Campus', memberIds: [c1] })).status, 403);
    const sched = await call('POST', `/applications/${created.id}/evc/schedule`, 'regW', { scheduledFor: nextHour(), venue: 'Campus', memberIds: [c1] });
    assert.equal(sched.status, 201, JSON.stringify(sched.body));
    assert.equal(sched.body.status, 'scheduled');

    const report = { outcome: 'satisfactory', findings: 'All facilities verified on site.' };
    assert.equal((await call('POST', `/applications/${created.id}/evc/report`, 'committee2', report)).status, 403, 'unassigned member');
    assert.equal((await call('POST', `/applications/${created.id}/evc/report`, 'committee', { outcome: 'satisfactory', findings: 'short' })).status, 400);
    assert.equal((await call('POST', `/applications/${created.id}/evc/report`, 'committee', report)).status, 201);

    const view = (await call('GET', `/applications/${created.id}`, 'committee')).body;
    assert.ok(view.availableActions.some((x: any) => x.key === 'evc_complete'));
    assert.match(view.availableActions.find((x: any) => x.key === 'evc_complete').label, /Expert Committee Review/);
    assert.equal((await call('GET', `/applications/${created.id}`, 'committee2')).body.availableActions.some((x: any) => x.key === 'evc_complete'), false);
    a = (await call('POST', `/applications/${created.id}/actions`, 'committee', { action: 'evc_complete', note: 'Report accepted' })).body;
    assert.equal(a.state, 'committee_review');
    await call('POST', `/applications/${created.id}/actions`, 'committee', { action: 'rec_approve', note: 'Fine' });
    a = (await call('POST', `/applications/${created.id}/actions`, 'admin', { action: 'approve' })).body;
    assert.equal(a.state, 'approved');
    const events = a.audit.map((x: any) => x.event);
    for (const e of ['EVC_SCHEDULED', 'EVC_REPORT_FILED', 'COMPLETE_EVC']) assert.ok(events.includes(e), e);
  });

  test('a deficiency raised during EVC returns there and opens a new visit round', async () => {
    const created = (await call('POST', '/applications', 'inst', intake('E2E EVC deficiency'))).body;
    for (const d of INTAKE_DOCS) await upload(created.id, 'inst', d);
    await call('POST', `/applications/${created.id}/actions`, 'inst', { action: 'submit' });
    await call('POST', `/applications/${created.id}/actions`, 'officer', { action: 'pass' });
    await call('POST', `/applications/${created.id}/actions`, 'officer', { action: 'clear' });
    const def = (await call('POST', `/applications/${created.id}/actions`, 'regW', { action: 'deficiency', note: 'Site not ready for visit' })).body;
    assert.equal(def.state, 'deficiency');
    const back = (await call('POST', `/applications/${created.id}/actions`, 'inst', { action: 'resubmit', note: 'Site ready' })).body;
    assert.equal(back.state, 'evc_visit');
    assert.equal(back.evc.round, 2);
    assert.equal(back.evc.status, 'awaiting_schedule');
  });
});

describe('regions', () => {
  test('regional officers are limited to their region; other roles can filter', async () => {
    const all = (await call<any[]>('GET', '/applications?scope=all', 'regN')).body;
    assert.ok(all.length > 0 && all.every((a) => a.region === 'Northern'));
    const west = (await call<any[]>('GET', '/applications?scope=all&region=Western', 'admin')).body;
    assert.ok(west.length > 0 && west.every((a) => a.region === 'Western'));
    const forced = (await call<any[]>('GET', '/applications?scope=all&region=Southern', 'regN')).body;
    assert.ok(forced.every((a) => a.region === 'Northern'), 'a regional officer cannot widen the filter');
    const sum = (await call('GET', '/analytics/summary?region=Southern', 'admin')).body;
    assert.equal(sum.region, 'Southern');
    assert.deepEqual(sum.byRegion.map((r: any) => r.region), ['Southern']);
    const national = (await call('GET', '/analytics/summary', 'admin')).body;
    assert.deepEqual(national.byRegion.map((r: any) => r.region).sort(), ['Central', 'Eastern', 'Northern', 'Southern', 'Western']);
    assert.ok(national.evc.awaitingSchedule >= 1 && national.evc.reportOverdue >= 1);
    const heat = (await call('GET', '/compliance/overview', 'regN')).body;
    assert.ok(heat.institutions.length > 0 && heat.institutions.every((i: any) => i.region === 'Northern'));
  });
});

describe('document validity register', () => {
  test('lease and prescribed documents: statuses, renewal, verification', async () => {
    const mine = (await call<any[]>('GET', '/validity', 'inst')).body;
    assert.ok(mine.length >= 2 && mine.every((d) => d.institution_id === mine[0].institution_id));
    const all = (await call<any[]>('GET', '/validity', 'admin')).body;
    const statuses = new Set(all.map((d) => d.status));
    for (const st of ['valid', 'expiring', 'expired', 'renewal_pending']) assert.ok(statuses.has(st), st);
    assert.ok(all.some((d) => d.kind === 'lease_deed'));
    assert.equal((await call<any[]>('GET', '/validity?status=expired', 'officer')).body.every((d) => d.status === 'expired'), true);

    // inst1 renews a still-valid lease; staff verify or reject it.
    const lease = mine.find((d) => d.kind === 'lease_deed');
    const early = await postForm(`/validity/${lease.id}/renew`, 'inst', { validUntil: '2020-01-01' });
    assert.equal(early.status, 400, 'renewal must extend validity');
    assert.equal((await postForm(`/validity/${lease.id}/renew`, 'inst3', { validUntil: '2099-01-01' })).status, 403, 'other institutions cannot renew it');
    const renewed = await postForm(`/validity/${lease.id}/renew`, 'inst', { validUntil: '2099-01-01', note: 'Renewed' });
    assert.equal(renewed.status, 201, JSON.stringify(renewed.body));
    assert.equal(renewed.body.status, 'renewal_pending');
    assert.equal((await call('POST', `/validity/${lease.id}/verify`, 'inst', { decision: 'approve' })).status, 403);
    assert.equal((await call('POST', `/validity/${lease.id}/verify`, 'officer', { decision: 'reject' })).status, 400, 'reject needs a reason');
    const rej = (await call('POST', `/validity/${lease.id}/verify`, 'officer', { decision: 'reject', note: 'Stamp duty receipt missing' })).body;
    assert.equal(rej.status, 'valid');
    assert.equal(rej.valid_until, lease.valid_until, 'expiry unchanged after rejection');
    await postForm(`/validity/${lease.id}/renew`, 'inst', { validUntil: '2099-01-01' });
    const ok = (await call('POST', `/validity/${lease.id}/verify`, 'officer', { decision: 'approve', note: 'Checked' })).body;
    assert.equal(ok.valid_until, '2099-01-01');
    assert.deepEqual(ok.history.map((h: any) => h.event).slice(-4), ['RENEWAL_SUBMITTED', 'RENEWAL_REJECTED', 'RENEWAL_SUBMITTED', 'RENEWAL_VERIFIED']);
  });

  test('expiry alerts escalate by level and a later scan raises nothing new', async () => {
    const alerts = (await call<any[]>('GET', '/alerts?kind=DOCUMENT_EXPIRING', 'admin')).body;
    assert.ok(alerts.length >= 5);
    assert.ok(alerts.some((a) => a.level === 4 && /expired/.test(a.message)), 'expired documents escalate to the top level');
    const again = (await call('POST', '/alerts/scan', 'admin')).body;
    assert.equal(again.documents, 0);
    const west = (await call('GET', '/notifications', 'regW')).body;
    assert.ok(west.items.some((n: any) => n.kind === 'EVC_UNSCHEDULED' || n.kind === 'QUEUE'), 'regional officer is alerted');
  });
});
