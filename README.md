# TrackWise

**Integrated AICTE Approval Workflow Automation, Compliance Monitoring and Alert Management System**
Smart India Hackathon, round 2 demo MVP (theme: smart automation).

> **All data is illustrative.** Institutions, people, thresholds and figures are invented for the demo and are
> **not real AICTE data or norms**. The UI carries a banner saying so, and uploaded documents in the seed are
> generated placeholder PDFs.

## What it does

| # | Capability | Where |
|---|---|---|
| 1 | Institution portal: new institution, new course, intake increase, extension of approval; document upload; status tracking | `web` + `api/src/workflow` |
| 2 | XState workflow: Draft → Submitted → Document Scrutiny → Compliance Check → Expert Committee Review → Decision → Approved / Rejected, with a Deficiency loop that returns to the stage that raised it. Every transition (and document upload) is audit-logged | `api/src/workflow/machine.ts` |
| 3 | Officer / committee dashboards: queue ordered by SLA urgency, document viewer, approve / reject / raise deficiency | `web/app/(app)/applications` |
| 4 | Compliance rules (faculty ratio, infrastructure, accreditation validity, fee norms) evaluated per institution per month, with score, trend chart and heatmap | `api/src/compliance` |
| 5 | BullMQ alert scans (SLA breach, expiring approvals, missing documents), in-app notifications, email stub, 3-level escalation rules editable by admin | `api/src/alerts` |
| 6 | AI service: document completeness/sanity checks and an explainable additive risk score | `ai/` |
| 7 | Role-based auth: institution, scrutiny officer, committee member, admin | `api/src/auth` |
| 8 | Analytics: pending by stage, turnaround, SLA breaches, risk mix, alert volume, compliance trend and heatmap | `web/app/(app)/analytics` |

## Architecture

```
 Next.js (web :3000) ──HTTP/JWT──▶ NestJS API (:4000) ──▶ PostgreSQL   (state, audit log, compliance, notifications)
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
| Committee members | `committee1@trackwise.demo`, `committee2@trackwise.demo` |
| Institutions | `inst01@trackwise.demo` … `inst14@trackwise.demo` (inst13 and inst14 are *proposed* new institutions) |

### Without Docker

`DATABASE_URL=postgres://user@127.0.0.1:5432/trackwise ./infra/dev-lite.sh` runs the AI service, the real API and the web
app with in-memory stand-ins for MinIO and Redis (documents vanish on restart; scans are triggered manually). It needs only a Postgres database.

## Demo script (about 8 minutes)

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

## Tests

```bash
# AI service
cd ai && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && .venv/bin/python -m pytest

# API unit tests (compliance engine, workflow machine)
cd api && npm ci && npm test

# API end-to-end (real Postgres + real AI service; MinIO/Redis replaced by in-memory fakes)
#   covers seed, happy path, deficiency loop, compliance gate, RBAC, alert scan, analytics
DATABASE_URL=postgres://user@127.0.0.1:5432/empty_db AI_URL=http://localhost:8000 npm run test:e2e
```

## Assumptions and limits (honest list)

- Norms (20:1 ratio, 4 sq m per student, ₹1.8 lakh fee cap, 180-day accreditation warning) and SLA hours are illustrative placeholders.
- The AI service is rules-based by design (explainable); it does not read document *contents*, only metadata (type, size, hash, extension).
- Alert emails are a stub (outbox table + BullMQ job that logs). No SMTP.
- Auth is a demo JWT in `localStorage` with shared demo passwords; there is no refresh, rate limiting or audit of reads.
- Documents are streamed through the API (no presigned URLs) so access control stays in one place.
- Intake-increase compliance projections add the extra seats to current enrolment once (a simplification).
- The seed backdates timestamps through the real workflow so SLA breaches and escalations are live, not hard-coded.
