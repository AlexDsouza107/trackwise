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
    for (const s of ['document_scrutiny', 'compliance_check', 'committee_review', 'decision', 'deficiency', 'approved', 'rejected']) {
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
    assert.deepEqual(first, { sla: 0, expiring: 0, missingDocs: 0 }, 'seed already scanned; nothing new');
    const alerts = (await call<any[]>('GET', '/alerts', 'admin')).body;
    const kinds = new Set(alerts.map((a) => a.kind));
    assert.deepEqual([...kinds].sort(), ['APPROVAL_EXPIRING', 'MISSING_DOCUMENTS', 'SLA_BREACH']);
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

