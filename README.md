# TrackWise

**Integrated AICTE Approval Workflow Automation, Compliance Monitoring and Alert Management System**
Smart India Hackathon, round 2 demo MVP (theme: smart automation).

> **All data is illustrative.** Institutions, people, thresholds and figures are invented for the demo and are
> **not real AICTE data or norms**. The UI carries a banner saying so, and uploaded documents in the seed are
> generated placeholder PDFs.

## What it does

| # | Capability | Where |
|---|---|---|
| 1 | **Workflow automation with configurable routing.** One XState machine; each application type has its own route through the stages (*only scrutiny*, *scrutiny + EVC*, *EVC only*, ...). Routes, stage time limits (SLA) and compliance thresholds are editable by an admin | `api/src/workflow`, `web/app/(app)/settings` |
| 2 | **Pendency monitoring and visibility.** Queues ordered by SLA urgency, per-region filters, overdue highlighting, region-wise performance (open, breached, turnaround, compliance) | `web/app/(app)/applications`, `analytics` |
| 3 | **Expert Visit Committee (EVC).** A real stage: regional officer schedules the visit and assigns committee members, members file the visit report, then the stage is completed or a deficiency raised. Reminders and escalation for unscheduled visits, upcoming visits and overdue reports | `api/src/workflow/evc.service.ts`, `web/app/(app)/evc` |
| 4 | **Compliance monitoring.** Faculty ratio, infrastructure, accreditation validity, fee norms: evaluated per institution per month, scored, trended, and enforced as a gate (critical failures block clearance). Accreditation is cross-checked against a (mock) registry | `api/src/compliance` |
| 5 | **Lease and prescribed-document validity.** A register with expiry tracking, advance alerts (90 / 30 / 7 days and on expiry), renewal submission and renewal verification by an officer | `api/src/validity`, `web/app/(app)/documents` |
| 6 | **Alerts and escalation.** BullMQ scans for SLA breach, expiring approvals, expiring documents, missing documents and the three EVC conditions; in-app notifications, e-mail stub, multi-level escalation rules editable by admin, deduplicated | `api/src/alerts` |
| 7 | **Audit trail.** Every transition, upload, removal, EVC scheduling and report is recorded with actor, role and note | `audit_log`, application detail page |
| 8 | **Standardised communications.** *Draft from findings* pre-fills the deficiency reason; a deficiency letter and an electronic case summary are generated as PDFs from the audit trail and automated checks | `api/src/letters` |
| 9 | **Integration adapters (mocks).** DigiLocker-style document fetch and an accreditation registry lookup behind small interfaces; clearly labelled as mocks | `api/src/integrations` |
| 10 | **Roles and regions.** Institution, scrutiny officer, committee member, **regional officer** (scoped to one region) and admin | `api/src/auth`, `common/access.ts` |
| 11 | **AI service (bonus signal).** Document completeness/sanity checks and an explainable additive risk score; it informs reviewers and never blocks the workflow | `ai/` |

### Default routes (illustrative; admins can change them)

| Application type | Path |
|---|---|
| New institution | Scrutiny → Compliance → **EVC** → Committee → Decision |
| New course | Scrutiny → Compliance → Committee → Decision |
| Intake increase | Scrutiny → Compliance → **EVC** → Committee → Decision |
| Extension of approval | Scrutiny → Compliance → Decision |

A deficiency raised at any stage returns to that same stage. Decision is always the last step.

## Architecture

```
 Next.js (web :3000) ──HTTP/JWT──▶ NestJS API (:4000) ──▶ PostgreSQL   (state, audit, compliance, EVC, document register)
                                        │   │──────────▶ MinIO         (application documents, streamed back through the API)
                                        │   │──────────▶ Redis/BullMQ  (periodic alert scan + email jobs, workers in-process)
                                        └──HTTP────────▶ FastAPI AI (:8000)  /check-documents  /risk-score
```

```
web/     Next.js 14 (app router) + Tailwind + Recharts
api/     NestJS 11, XState 5, pg, BullMQ, S3 client (MinIO), zod
ai/      FastAPI (rules-based, no ML dependencies), pytest
infra/   dev-lite.sh (run without Docker); docker-compose.yml lives at the repo root so `docker compose up` works
```

Design notes:
- **The machine decides validity, the API decides permission.** `machine.ts` says whether an event is legal in a state
  (e.g. `CLEAR_COMPLIANCE` has a guard that blocks on critical failures); an `ACTIONS` table says which role may fire it.
  The UI renders `availableActions` straight from the server, so buttons can never drift from the rules.
- Transitions run in a transaction with `SELECT … FOR UPDATE`, write the audit row, then run entry side effects
  (AI re-check, compliance what-if, notifications, approval validity), which may chain further events (the automatic intake).
- **AI never blocks the workflow**: if the AI service is down the application still moves; the panel says it was unavailable.
- Escalation: `after_hours` per kind and level is stored in `escalation_rules` (editable at *Alerts → Escalation rules*).
  Each (entity, level) raises once (deduplicated by key).

## Run it

```bash
docker compose up --build
```

| Service | URL |
|---|---|
| Web app | http://localhost:3000 |
| API | http://localhost:4000 (`/health`) |
| AI service docs | http://localhost:8000/docs |
| MinIO console | http://localhost:9001 (`trackwise` / `trackwise-secret`) |

On first boot the API creates the schema and seeds illustrative data (about 2 seconds). Watch `docker compose logs -f api` for
`[EMAIL STUB]` lines. Optional overrides: copy `.env.example` to `.env`.

All demo accounts use the password **`demo1234`**; the login page offers one-click sign-in:

| Role | Account |
|---|---|
| Admin | `admin@trackwise.demo` |
| Scrutiny officers | `officer1@trackwise.demo`, `officer2@trackwise.demo` |
| Regional officers | `regional1` Northern, `regional2` Southern, `regional3` Eastern, `regional4` Western, `regional5` Central (`@trackwise.demo`) |
| Committee members | `committee1@trackwise.demo`, `committee2@trackwise.demo` |
| Institutions | `inst01@trackwise.demo` … `inst14@trackwise.demo` (inst13 and inst14 are *proposed* new institutions) |

### Without Docker

`DATABASE_URL=postgres://user@127.0.0.1:5432/trackwise ./infra/dev-lite.sh` runs the AI service, the real API and the web
app with in-memory stand-ins for MinIO and Redis (documents vanish on restart; scans are triggered manually). It needs only a Postgres database.

## Demo script (about 12 minutes; A to C are the core 8)

Seeded applications are found by title; reference numbers (`TW-<year>-<n>`) depend on when you seed.

### A. Happy path (`inst01` → `officer1` → `committee1` → `admin`)
1. Sign in as **`inst01`** (Sahyadri Demo Institute). *New application* → **New Course**, title "B.Tech Quantum Computing",
   course name, level UG, intake 30 → *Create draft*.
2. Upload all five required documents (any small PDF or image works; the checklist ticks as you go) → **Submit application**.
   The stage jumps through *Submitted* to *Document Scrutiny* automatically (AI check + risk score run on intake).
3. Sign out, sign in as **`officer1`**. The **queue** is ordered by SLA, with breached items first. Open your application:
   view a document in the viewer, read the **AI assessment** (every risk point is itemised) and the document check →
   **Documents verified** → stage *Compliance Check* → review the rule results → **Compliance cleared**.
4. Sign in as **`committee1`** → open it from the queue → **Recommend approval** (note required).
5. Sign in as **`admin`** → *Decision* queue → **Approve**. Open the **audit trail**: every transition with actor, role, note and time.
6. Back as `inst01`: *Alerts* shows the status notifications. As `admin`: *Alerts → Email outbox* shows the stubbed email.

### B. Deficiency loop
1. As **`inst05`** (Thar Demo Institute of Pharmacy) open **Extension of approval 2026-27**. It is in *Deficiency*, overdue, with the
   officer's reason in a banner and two missing documents.
2. Upload *Accreditation certificate* and *Audited accounts*, add a note, **Resubmit with corrections**.
   It returns to *Document Scrutiny* (the stage that raised it); the stepper and audit trail record round 1.
3. Sign in as `officer1`: the application is back in your queue with **Deficiencies = 1**.
4. To see it live from scratch: create an application as any institution, upload only some documents, submit, and as an officer
   click **Raise deficiency** (it refuses without a note).

### C. Compliance gate, alerts and analytics
1. As **`officer1`** open **ECE intake 60 to 120** (Narmada). Compliance shows a critical student:faculty failure
   (projected with the extra intake) and *only* **Raise deficiency** is offered; the machine guard blocks clearance.
2. *Compliance* → heatmap (✓ / ! / ✕ with scores) → click **Konkan** (lapsed accreditation) for its trend and rule details.
3. As **`admin`** → *Alerts*: *Alert log* shows SLA breaches with escalation levels (L1 to the stage owner, L2 and L3 to admin with email),
   expiring approvals (Kaveri, Thar) and missing-document alerts for stale drafts. Edit a rule's hours in *Escalation rules*,
   then **Run alert scan now**. The alerts are deduplicated, so a second scan raises nothing new.
4. *Analytics*: pending by stage, turnaround, SLA breaches, risk mix, 14-day alert volume, compliance heatmap.

### D. Expert visit (EVC) and regions
1. As **`regional4`** (Western) open *Expert visits*: **AI & Data Science intake 60 to 90** *needs scheduling* (already escalated, because it has waited too long).
   Open it → **Schedule the visit** (date, venue, one or both committee members). Reminders and an overdue-report escalation are now armed.
2. Sign in as **`committee1`** → *Expert visits*: your assigned visits. On **Establish Himalaya Demo Institute** the visit report is filed; use
   **EVC visit complete** to send it to the committee. On a visit you are assigned to, **Record the visit report** (outcome + findings).
3. As **`regional1`** (Northern) the queue and every dashboard are limited to the Northern region; opening a Western application returns *403*.
4. As **`admin`**: *Analytics* → region selector and the **region-wise performance** table; *Expert visits* shows *report overdue* (Malabar) and *in 20h* (Ganga).

### E. Lease and document validity
1. As **`inst03`** (Kaveri) open *Document validity*: the expired lease already has a **renewal pending**; the fire safety certificate is *expiring soon* → **Renew**.
2. As **`officer1`** open *Document validity* → **Verify** or **Reject** (a reason is required) the pending renewal; the institution is notified.
3. As **`admin`** → *Alerts*: *document expiring* alerts escalate by level, and **Run alert scan now** raises nothing new (deduplicated).

### F. Configuration, communications and integrations
1. As **`admin`** → *Settings* → untick **Compliance Check** for *Extension of Approval* → Save. A new extension now goes Scrutiny → Decision.
   Change a threshold (for example the faculty ratio) and **Re-evaluate all institutions**; the heatmap changes.
2. As **`officer1`** on an application → **Raise deficiency** → **✎ Draft from findings** fills the reason from the missing documents, failed rules and EVC report.
   Then **Deficiency letter (PDF)** and **Case summary (PDF)** under *Communications*.
3. As **`inst05`** (draft or deficiency) click **⇩ DigiLocker** on a document row and enter any 6+ character reference (the mock rejects references ending in `000`).
4. In *Compliance*, an institution's detail shows the **accreditation registry cross-check** (Kaveri is a deliberate mismatch).

## Tests

```bash
# AI service
cd ai && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && .venv/bin/python -m pytest

# API unit tests (compliance engine, workflow machine incl. routing and EVC)
cd api && npm ci && npm test

# API end-to-end (real Postgres + real AI service; MinIO/Redis replaced by in-memory fakes)
#   covers seed, routing, EVC, regions, document validity, letters, integrations, configuration, RBAC, alerts, analytics
DATABASE_URL=postgres://user@127.0.0.1:5432/empty_db AI_URL=http://localhost:8000 npm run test:e2e

# Smoke test of a RUNNING stack (docker compose or dev-lite)
./infra/smoke.sh      # API=http://localhost:4000 WEB=http://localhost:3000 by default
```

3 AI tests, 11 unit tests, 23 end-to-end tests. `.github/workflows/ci.yml` runs all of them on every push and then builds and smoke-tests the **full docker compose stack**
(Postgres, Redis, MinIO, AI, API, web), so the Docker path is verified in CI rather than on a developer laptop.

## Assumptions and limits (honest list)

- Norms (20:1 ratio, 4 sq m per student, 1.8 lakh fee cap, 180-day accreditation warning), SLA hours, routes, regions and the document list are illustrative placeholders. The configurable parts are
  editable in *Settings*; they are not the official Approval Process Handbook.
- The AI service is rules-based by design (explainable); it does not read document *contents*, only metadata. It is a bonus signal, not part of the approval decision.
- Integrations (DigiLocker-style fetch, accreditation registry) are **mocks** behind adapter interfaces. E-mail is a stub (outbox table + BullMQ job that logs). No SMTP.
- Regions are a simple state-to-region grouping. Regional officers are region-scoped; scrutiny officers and committee members are a national pool.
- Auth is a demo JWT in `localStorage` with shared demo passwords; there is no refresh, rate limiting or audit of reads.
- Documents are streamed through the API (no presigned URLs) so access control stays in one place.
- Intake-increase compliance projections add the extra seats to current enrolment once (a simplification).
- A changed route applies to applications submitted after the change; in-flight applications keep the route they were submitted with.
- The seed backdates timestamps through the real workflow so SLA breaches, EVC reminders and escalations are live, not hard-coded.
- `docker compose up` has not been run on the development machine (no Docker installed there). Everything was verified natively, `infra/smoke.sh` passes against the no-Docker stack,
  and CI builds and smoke-tests the compose stack on every push (green as of v1.2.1; it caught a removed MinIO image, now `bitnamilegacy/minio`). Check the latest *CI* run on GitHub before presenting.
