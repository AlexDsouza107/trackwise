import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { ScannerService } from '../alerts/scanner.service';
import { ApplicationType, AuthUser, REQUIRED_DOCUMENTS, Role } from '../common/types';
import { REGIONS, regionOf } from '../common/regions';
import { ComplianceService } from '../compliance/compliance.service';
import { ValidityService, VALIDITY_KINDS } from '../validity/validity.service';
import { EvcService } from '../workflow/evc.service';
import { config } from '../config';
import { DbService } from '../db/db.service';
import { ApplicationsService } from '../workflow/applications.service';
import { simplePdf } from './pdf';

/**
 * ALL DATA HERE IS ILLUSTRATIVE. Institutions, people and numbers are invented for the demo
 * and do not reflect real AICTE figures, norms or institutions.
 */
const PASSWORD = 'demo1234';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

interface InstSeed {
  name: string; city: string; state: string; status?: 'active' | 'proposed';
  f: number; s: number; area: number; labs: number; fee: number; accDays: number | null; dF: number; dS: number; dArea?: number; approvalDays: number | null;
}

const INSTITUTIONS: InstSeed[] = [
  { name: 'Sahyadri Demo Institute of Technology', city: 'Pune', state: 'Maharashtra', f: 110, s: 1900, area: 9500, labs: 10, fee: 150000, accDays: 600, dF: 2, dS: 0, approvalDays: 500 },
  { name: 'Narmada Illustrative College of Engineering', city: 'Bhopal', state: 'Madhya Pradesh', f: 90, s: 1850, area: 8200, labs: 8, fee: 140000, accDays: 300, dF: -2, dS: 25, approvalDays: 420 },
  { name: 'Kaveri Demo School of Management', city: 'Bengaluru', state: 'Karnataka', f: 60, s: 1000, area: 5200, labs: 6, fee: 170000, accDays: 45, dF: 0, dS: 0, approvalDays: 40 },
  { name: 'Ganga Illustrative Polytechnic', city: 'Lucknow', state: 'Uttar Pradesh', f: 75, s: 1300, area: 6500, labs: 7, fee: 195000, accDays: 400, dF: 1, dS: 5, approvalDays: 365 },
  { name: 'Thar Demo Institute of Pharmacy', city: 'Jaipur', state: 'Rajasthan', f: 50, s: 800, area: 2400, labs: 4, fee: 120000, accDays: 200, dF: 0, dS: 10, approvalDays: 75 },
  { name: 'Nilgiri Illustrative Institute of Architecture', city: 'Coimbatore', state: 'Tamil Nadu', f: 40, s: 600, area: 4000, labs: 7, fee: 130000, accDays: 700, dF: 1, dS: 0, approvalDays: 800 },
  { name: 'Brahmaputra Demo College of Engineering', city: 'Guwahati', state: 'Assam', f: 55, s: 1450, area: 6800, labs: 8, fee: 110000, accDays: 365, dF: -1, dS: 15, approvalDays: 300 },
  { name: 'Konkan Illustrative Institute of Technology', city: 'Ratnagiri', state: 'Maharashtra', f: 70, s: 1200, area: 6000, labs: 7, fee: 125000, accDays: -20, dF: 0, dS: 0, approvalDays: -10 },
  { name: 'Deccan Demo Institute of Computer Applications', city: 'Hyderabad', state: 'Telangana', f: 65, s: 1100, area: 5600, labs: 9, fee: 179000, accDays: 500, dF: 1, dS: 0, approvalDays: 600 },
  { name: 'Sundarbans Illustrative Technical Campus', city: 'Kolkata', state: 'West Bengal', f: 80, s: 1700, area: 6900, labs: 6, fee: 135000, accDays: 150, dF: 0, dS: 20, approvalDays: 250 },
  { name: 'Aravalli Demo Institute of Engineering', city: 'Udaipur', state: 'Rajasthan', f: 80, s: 1500, area: 5000, labs: 5, fee: 140000, accDays: 365, dF: 4, dS: -10, dArea: 350, approvalDays: 330 },
  { name: 'Malabar Illustrative College of Technology', city: 'Kochi', state: 'Kerala', f: 95, s: 1600, area: 8800, labs: 11, fee: 145000, accDays: 800, dF: 1, dS: 0, approvalDays: 900 },
  { name: 'Himalaya Demo Institute (Proposed)', city: 'Dehradun', state: 'Uttarakhand', status: 'proposed', f: 40, s: 600, area: 3000, labs: 6, fee: 140000, accDays: null, dF: 0, dS: 0, approvalDays: null },
  { name: 'Chilika Illustrative Technical Institute (Proposed)', city: 'Bhubaneswar', state: 'Odisha', status: 'proposed', f: 30, s: 540, area: 2600, labs: 5, fee: 135000, accDays: null, dF: 0, dS: 0, approvalDays: null },
];

/** `regional` resolves to the regional officer of the application's region. */
type Who = 'inst' | 'officer1' | 'officer2' | 'committee1' | 'committee2' | 'regional' | 'admin';
type Step = [key: string, who: Who, hoursAgo: number, note?: string, opts?: { hoursAhead?: number; venue?: string; outcome?: string }];

interface Scenario {
  inst: number; // 1-based index into INSTITUTIONS
  type: ApplicationType; title: string; details: Record<string, unknown>;
  ageH: number; omit?: string[]; tiny?: string[]; steps: Step[];
}

const HAPPY = (t0: number, gap = [30, 20, 60, 25]): Step[] => [
  ['submit', 'inst', t0],
  ['pass', 'officer1', t0 - gap[0]],
  ['clear', 'officer2', t0 - gap[0] - gap[1]],
  ['rec_approve', 'committee1', t0 - gap[0] - gap[1] - gap[2], 'Meets norms; recommended.'],
  ['approve', 'admin', t0 - gap[0] - gap[1] - gap[2] - gap[3]],
];

/** Extension of approval routes through scrutiny and compliance only, then straight to the decision. */
const HAPPY_EXT = (t0: number, gap = [30, 20, 30]): Step[] => [
  ['submit', 'inst', t0],
  ['pass', 'officer1', t0 - gap[0]],
  ['clear', 'officer2', t0 - gap[0] - gap[1]],
  ['approve', 'admin', t0 - gap[0] - gap[1] - gap[2]],
];

/** Intake increase routes through an Expert Visit Committee stage before the committee. */
const HAPPY_EVC = (t0: number): Step[] => [
  ['submit', 'inst', t0],
  ['pass', 'officer1', t0 - 28],
  ['clear', 'officer2', t0 - 50],
  ['evc_schedule', 'regional', t0 - 55, undefined, { hoursAhead: 24, venue: 'Institute campus' }],
  ['evc_report', 'committee1', t0 - 85, 'Facilities match the application; labs and library verified on site.', { outcome: 'satisfactory' }],
  ['evc_complete', 'regional', t0 - 90, 'Visit report accepted.'],
  ['rec_approve', 'committee1', t0 - 140, 'Meets norms; recommended.'],
  ['approve', 'admin', t0 - 160],
];

const SCENARIOS: Scenario[] = [
  // ---- completed history (drives turnaround analytics) ----
  { inst: 1, type: 'extension_of_approval', title: 'Extension of approval 2025-26', details: { academicYear: '2025-26', yearsRequested: 2 }, ageH: 1400, steps: HAPPY_EXT(1400) },
  { inst: 6, type: 'new_course', title: 'B.Arch (Landscape) new course', details: { courseName: 'B.Arch Landscape', level: 'UG', intake: 40 }, ageH: 1100, steps: HAPPY(1100, [40, 30, 70, 30]) },
  { inst: 12, type: 'intake_increase', title: 'CSE intake 120 to 180', details: { courseName: 'B.Tech CSE', currentIntake: 120, proposedIntake: 180, justification: 'Industry demand and added labs.' }, ageH: 900, steps: HAPPY_EVC(900) },
  { inst: 9, type: 'new_course', title: 'MCA (AI & Data) new course', details: { courseName: 'MCA AI & Data', level: 'PG', intake: 60 }, ageH: 700, steps: HAPPY(700, [35, 25, 65, 24]) },
  { inst: 4, type: 'extension_of_approval', title: 'Extension of approval 2025-26', details: { academicYear: '2025-26', yearsRequested: 1 }, ageH: 600, steps: HAPPY_EXT(600, [26, 18, 22]) },
  { inst: 4, type: 'new_course', title: 'Diploma in Robotics', details: { courseName: 'Diploma Robotics', level: 'Diploma', intake: 60 }, ageH: 1000,
    steps: [['submit', 'inst', 1000], ['pass', 'officer1', 960], ['deficiency', 'officer2', 930, 'Faculty list does not cover the new course.'], ['resubmit', 'inst', 800, 'Updated faculty list uploaded.'], ['clear', 'officer1', 760], ['rec_reject', 'committee2', 680, 'Fee exceeds the cap and lab inventory is thin.'], ['reject', 'admin', 650, 'Rejected in line with the committee recommendation.']] },
  { inst: 7, type: 'intake_increase', title: 'Civil intake 60 to 180', details: { courseName: 'B.Tech Civil', currentIntake: 60, proposedIntake: 180, justification: 'Regional demand.' }, ageH: 500,
    steps: [['submit', 'inst', 500], ['reject', 'officer2', 470, 'Intake tripling is not supported by documented infrastructure.']] },

  // ---- in flight ----
  { inst: 2, type: 'intake_increase', title: 'ECE intake 60 to 120', details: { courseName: 'B.Tech ECE', currentIntake: 60, proposedIntake: 120, justification: 'New lab block commissioned.' }, ageH: 200, tiny: ['faculty_list'],
    steps: [['submit', 'inst', 200], ['pass', 'officer1', 30]] }, // compliance stage, critical failure expected (ratio)
  { inst: 10, type: 'new_course', title: 'B.Tech Data Science', details: { courseName: 'B.Tech Data Science', level: 'UG', intake: 60 }, ageH: 180,
    steps: [['submit', 'inst', 180], ['pass', 'officer2', 140]] }, // scrutiny breached? (at 140h in compliance: SLA 72 -> breached)
  { inst: 3, type: 'extension_of_approval', title: 'Extension of approval 2026-27', details: { academicYear: '2026-27', yearsRequested: 3 }, ageH: 160,
    steps: [['submit', 'inst', 160], ['pass', 'officer1', 100]] }, // compliance, 28h overdue
  { inst: 11, type: 'intake_increase', title: 'Mechanical intake 60 to 90', details: { courseName: 'B.Tech Mechanical', currentIntake: 60, proposedIntake: 90, justification: 'Improved faculty strength.' }, ageH: 100,
    steps: [['submit', 'inst', 100]] }, // scrutiny 100h -> 28h overdue
  { inst: 12, type: 'new_course', title: 'M.Tech Embedded Systems', details: { courseName: 'M.Tech Embedded Systems', level: 'PG', intake: 18 }, ageH: 60,
    steps: [['submit', 'inst', 60]] }, // scrutiny 60h: due in 12h
  { inst: 6, type: 'intake_increase', title: 'B.Arch intake 40 to 60', details: { courseName: 'B.Arch', currentIntake: 40, proposedIntake: 60, justification: 'Studio expansion complete.' }, ageH: 10,
    steps: [['submit', 'inst', 10]] },
  { inst: 1, type: 'new_course', title: 'B.Tech Cyber Security', details: { courseName: 'B.Tech Cyber Security', level: 'UG', intake: 60 }, ageH: 330,
    steps: [['submit', 'inst', 330], ['pass', 'officer1', 300], ['clear', 'officer2', 270]] }, // committee, 150h -> 30h overdue
  { inst: 12, type: 'extension_of_approval', title: 'Extension of approval 2026-27', details: { academicYear: '2026-27', yearsRequested: 2 }, ageH: 140,
    steps: [['submit', 'inst', 140], ['pass', 'officer2', 110], ['clear', 'officer1', 90]] }, // committee fresh-ish
  { inst: 9, type: 'intake_increase', title: 'MCA intake 60 to 90', details: { courseName: 'MCA', currentIntake: 60, proposedIntake: 90, justification: 'Placement record improved.' }, ageH: 200,
    steps: [['submit', 'inst', 200], ['pass', 'officer1', 170], ['clear', 'officer1', 150],
      ['evc_schedule', 'regional', 140, undefined, { hoursAhead: 20, venue: 'Institute campus' }],
      ['evc_report', 'committee2', 110, 'Placement cell and labs verified.', { outcome: 'minor_gaps' }],
      ['evc_complete', 'regional', 100, 'Minor gaps noted; not blocking.'],
      ['rec_approve', 'committee1', 12, 'Recommended with annual review.']] }, // decision
  { inst: 5, type: 'extension_of_approval', title: 'Extension of approval 2026-27', details: { academicYear: '2026-27', yearsRequested: 1 }, ageH: 400, omit: ['audited_accounts', 'accreditation_certificate'],
    steps: [['submit', 'inst', 400], ['deficiency', 'officer1', 300, 'Audited accounts and accreditation certificate are missing.']] }, // deficiency, 60h overdue
  { inst: 10, type: 'new_course', title: 'B.Tech Mechatronics', details: { courseName: 'B.Tech Mechatronics', level: 'UG', intake: 60 }, ageH: 120, omit: ['lab_inventory'],
    steps: [['submit', 'inst', 120], ['pass', 'officer2', 90], ['deficiency', 'officer2', 20, 'Lab inventory is required for a new course.']] },
  { inst: 7, type: 'extension_of_approval', title: 'Extension of approval 2026-27', details: { academicYear: '2026-27', yearsRequested: 1 }, ageH: 300,
    steps: [['submit', 'inst', 300], ['deficiency', 'officer1', 250, 'Infrastructure certificate is outdated.'], ['resubmit', 'inst', 40, 'Fresh certificate uploaded.']] },

  // ---- Expert Visit Committee pipeline ----
  { inst: 1, type: 'intake_increase', title: 'AI & Data Science intake 60 to 90', details: { courseName: 'B.Tech AI & DS', currentIntake: 60, proposedIntake: 90, justification: 'New AI lab and faculty hires.' }, ageH: 260,
    steps: [['submit', 'inst', 260], ['pass', 'officer1', 230], ['clear', 'officer2', 200]] }, // EVC stage, visit not yet scheduled (Western)
  { inst: 4, type: 'intake_increase', title: 'Electrical intake 60 to 90', details: { courseName: 'Diploma Electrical', currentIntake: 60, proposedIntake: 90, justification: 'Industry partnership for apprenticeships.' }, ageH: 170,
    steps: [['submit', 'inst', 170], ['pass', 'officer1', 150], ['clear', 'officer2', 125],
      ['evc_schedule', 'regional', 120, undefined, { hoursAhead: 140, venue: 'Institute campus' }]] }, // visit due in ~20h: reminders fire (Northern)
  { inst: 12, type: 'intake_increase', title: 'Civil intake 60 to 90', details: { courseName: 'B.Tech Civil', currentIntake: 60, proposedIntake: 90, justification: 'Government infrastructure demand.' }, ageH: 320,
    steps: [['submit', 'inst', 320], ['pass', 'officer1', 290], ['clear', 'officer2', 270],
      ['evc_schedule', 'regional', 260, undefined, { hoursAhead: 50, venue: 'Institute campus' }]] }, // visit date passed, report overdue (Southern)

  // ---- drafts ----
  { inst: 4, type: 'new_course', title: 'B.Voc Industrial Automation', details: { courseName: 'B.Voc Industrial Automation', level: 'UG', intake: 40 }, ageH: 60, omit: ['curriculum', 'lab_inventory'], steps: [] },
  { inst: 3, type: 'intake_increase', title: 'MBA intake 120 to 150', details: { courseName: 'MBA', currentIntake: 120, proposedIntake: 150, justification: 'Strong admissions cycle.' }, ageH: 200, omit: ['fee_structure', 'previous_approval_letter', 'infrastructure_certificate'], steps: [] },

  // ---- proposed (new) institutions ----
  { inst: 13, type: 'new_institution', title: 'Establish Himalaya Demo Institute', ageH: 90,
    details: { programmes: 'B.Tech CSE, B.Tech ECE', proposedIntake: 240, facultyCount: 40, studentCount: 600, builtUpSqm: 3000, labCount: 6, annualFee: 140000, accreditationValidUntil: '2030-01-01' },
    steps: [['submit', 'inst', 90], ['pass', 'officer1', 75], ['clear', 'officer2', 60],
      ['evc_schedule', 'regional', 55, undefined, { hoursAhead: 20, venue: 'Proposed campus site' }],
      ['evc_report', 'committee1', 30, 'Site and buildings inspected; construction is ahead of the submitted plan.', { outcome: 'satisfactory' }]] }, // EVC report filed, stage not yet completed
  { inst: 14, type: 'new_institution', title: 'Establish Chilika Illustrative Technical Institute', ageH: 30, omit: ['financial_solvency', 'undertaking'],
    details: { programmes: 'B.Tech Civil, B.Tech Mechanical', proposedIntake: 180, facultyCount: 18, studentCount: 540, builtUpSqm: 2000, labCount: 3, annualFee: 190000 }, steps: [] },
];

@Injectable()
export class SeedService implements OnApplicationBootstrap {
  private readonly log = new Logger('Seed');

  constructor(
    private readonly db: DbService,
    private readonly apps: ApplicationsService,
    private readonly compliance: ComplianceService,
    private readonly scanner: ScannerService,
    private readonly evc: EvcService,
    private readonly validity: ValidityService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!config.seedDemoData) return;
    if (await this.db.one("select 1 from app_meta where key='seeded'")) return;
    // No completion marker: wipe any partial earlier attempt so seeding is all-or-nothing.
    await this.db.query(
      `truncate audit_log, documents, evc_visits, institution_documents, applications, compliance_results, compliance_scores, institution_metrics,
                notifications, alerts, email_outbox, users, institutions restart identity cascade`);
    this.log.log('Seeding ILLUSTRATIVE demo data (not real AICTE data)...');
    const t = Date.now();
    const users = await this.seedPeopleAndInstitutions();
    await this.seedMetrics();
    await this.seedApplications(users);
    await this.seedValidityDocuments(users);
    await this.setApprovalDates();
    this.log.log(`Scan after seed: ${JSON.stringify(await this.scanner.scan())}`);
    // Spread alert timestamps over the last two weeks so the volume chart has shape (illustrative).
    await this.db.query(`update alerts set created_at = now() - ((id * 7919) % 14) * interval '1 day'`);
    await this.db.query("insert into app_meta (key, value) values ('seeded', now()::text)");
    this.log.log(`Seed finished in ${((Date.now() - t) / 1000).toFixed(1)}s`);
  }

  private async seedPeopleAndInstitutions(): Promise<Record<string, AuthUser>> {
    const hash = await bcrypt.hash(PASSWORD, 8);
    const out: Record<string, AuthUser> = {};
    const add = async (key: string, email: string, name: string, role: Role, institutionId: number | null, region: string | null = null) => {
      const row = await this.db.one<{ id: number }>(
        'insert into users (email, name, password_hash, role, institution_id, region) values ($1,$2,$3,$4,$5,$6) returning id',
        [email, name, hash, role, institutionId, region]);
      out[key] = { id: row!.id, name, email, role, institutionId, region };
    };
    const staff: [string, string, string, Role][] = [
      ['admin', 'admin@trackwise.demo', 'Dr. Meera Iyer (Admin)', 'admin'],
      ['officer1', 'officer1@trackwise.demo', 'Arjun Nair (Scrutiny Officer)', 'officer'],
      ['officer2', 'officer2@trackwise.demo', 'Kavita Rao (Scrutiny Officer)', 'officer'],
      ['committee1', 'committee1@trackwise.demo', 'Prof. S. Banerjee (Committee)', 'committee'],
      ['committee2', 'committee2@trackwise.demo', 'Dr. Farah Khan (Committee)', 'committee'],
    ];
    for (const [k, e, n, r] of staff) await add(k, e, n, r, null);
    const regionalNames = ['Rohan Mehta', 'Lakshmi Pillai', 'Anirban Das', 'Sneha Kulkarni', 'Imran Qureshi'];
    for (const [i, region] of REGIONS.entries()) {
      await add(`reg:${region}`, `regional${i + 1}@trackwise.demo`, `${regionalNames[i]} (Regional Officer, ${region})`, 'regional', null, region);
    }

    for (const [i, inst] of INSTITUTIONS.entries()) {
      const idx = i + 1;
      const days = inst.approvalDays;
      const row = await this.db.one<{ id: number }>(
        `insert into institutions (name, code, state, city, region, status, approval_valid_until)
         values ($1,$2,$3,$4,$5,$6, case when $7::int is null then null else current_date + $7::int end) returning id`,
        [inst.name, `DEMO-${String(idx).padStart(4, '0')}`, inst.state, inst.city, regionOf(inst.state), inst.status ?? 'active', days]);
      await add(`inst${idx}`, `inst${String(idx).padStart(2, '0')}@trackwise.demo`, `Registrar, ${inst.name.split(' ')[0]}`, 'institution', row!.id);
    }
    return out;
  }

  private async seedMetrics(): Promise<void> {
    const today = new Date();
    for (const [i, inst] of INSTITUTIONS.entries()) {
      if (inst.status === 'proposed') continue;
      const id = i + 1;
      const accUntil = inst.accDays === null ? null : new Date(today.getTime() + inst.accDays * DAY).toISOString().slice(0, 10);
      for (let m = 5; m >= 0; m--) {
        const first = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - m, 1));
        const k = 5 - m; // 0..5 oldest to newest
        const metrics = {
          facultyCount: inst.f + inst.dF * (k - 5), studentCount: inst.s + inst.dS * (k - 5),
          builtUpSqm: inst.area + (inst.dArea ?? 0) * (k - 5), labCount: inst.labs, annualFee: inst.fee, accreditationValidUntil: accUntil,
        };
        const period = first.toISOString().slice(0, 10);
        await this.compliance.saveMetrics(id, period, metrics);
        await this.compliance.evaluateInstitution(id, period, new Date(first.getTime() + 14 * DAY));
      }
    }
  }

  private docFor(type: string, reference: string, instName: string, tiny: boolean): Buffer {
    if (tiny) return Buffer.from('%PDF-1.4 stub');
    return simplePdf([
      'ILLUSTRATIVE DEMO DOCUMENT - NOT A REAL FILING',
      '',
      `Document: ${type.replace(/_/g, ' ')}`,
      `Application: ${reference}`,
      `Institution: ${instName}`,
      '',
      'Generated by the TrackWise seed script for demonstration purposes.',
      'Contents are fictitious and carry no regulatory meaning.',
    ]);
  }

  private async seedApplications(users: Record<string, AuthUser>): Promise<void> {
    const now = Date.now();
    const at = (hoursAgo: number) => new Date(now - hoursAgo * HOUR);
    for (const sc of SCENARIOS) {
      const inst = users[`inst${sc.inst}`];
      const created = await this.apps.create(inst, { type: sc.type, title: sc.title, details: sc.details }, at(sc.ageH + 1));
      const instName = INSTITUTIONS[sc.inst - 1].name;
      for (const docType of REQUIRED_DOCUMENTS[sc.type]) {
        if (sc.omit?.includes(docType)) continue;
        await this.apps.uploadDocument(inst, created.id, {
          docType, filename: `${docType}.pdf`, contentType: 'application/pdf',
          buffer: this.docFor(docType, created.reference, instName, !!sc.tiny?.includes(docType)),
        }, at(sc.ageH + 0.5));
      }
      for (const [key, who, hoursAgo, note, opts] of sc.steps) {
        const actor = who === 'inst' ? inst : who === 'regional' ? users[`reg:${regionOf(INSTITUTIONS[sc.inst - 1].state)}`] : users[who];
        if (key === 'evc_schedule') {
          await this.evc.schedule(actor, created.id, {
            scheduledFor: new Date(at(hoursAgo).getTime() + (opts?.hoursAhead ?? 48) * HOUR).toISOString(),
            venue: opts?.venue ?? 'Institute campus', memberIds: [users.committee1.id, users.committee2.id],
          }, at(hoursAgo));
        } else if (key === 'evc_report') {
          await this.evc.report(actor, created.id, { outcome: (opts?.outcome ?? 'satisfactory') as 'satisfactory', findings: note ?? 'Visit completed.' }, at(hoursAgo));
        } else {
          await this.apps.act(actor, created.id, key, note, at(hoursAgo));
        }
      }
    }
  }

  /** Lease and other prescribed documents, with an illustrative mix of valid, expiring, expired and renewal-pending. */
  private async seedValidityDocuments(users: Record<string, AuthUser>): Promise<void> {
    // days from today until expiry, per institution (1-based, active institutions only)
    const plan: Record<string, number[]> = {
      lease_deed: [700, 25, -12, 400, 60, 900, 150, -40, 500, 20, 300, 800],
      fire_safety_certificate: [200, 500, 35, 90, 300, 120, -5, 250, 15, 400, -20, 600],
      structural_safety_certificate: [800, 700, 0, 0, 500, 0, 0, 0, 0, 0, 90, 5],
      land_use_permission: [0, 0, 0, 0, 0, 900, 0, 0, 0, 0, 0, 0],
    };
    const iso = (days: number) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);
    const pdf = (kind: string, inst: string) => Buffer.from(simplePdf([
      'ILLUSTRATIVE DEMO DOCUMENT - NOT A REAL FILING', '', `Document: ${VALIDITY_KINDS[kind]}`, `Institution: ${inst}`, '', 'Generated by the TrackWise seed script.']));
    const file = (kind: string, inst: string, suffix = '') => ({ originalname: `${kind}${suffix}.pdf`, mimetype: 'application/pdf', buffer: pdf(kind, inst) });
    const renewals: Record<string, { instIdx: number; days: number }> = { 'lease_deed:3': { instIdx: 3, days: 730 }, 'fire_safety_certificate:11': { instIdx: 11, days: 365 } };
    for (const [kind, days] of Object.entries(plan)) {
      for (const [i, d] of days.entries()) {
        if (!d) continue;
        const idx = i + 1;
        const inst = users[`inst${idx}`];
        const name = INSTITUTIONS[i].name;
        const doc = await this.validity.add(inst, { kind, reference: `${kind.slice(0, 3).toUpperCase()}/${2020 + (idx % 5)}/${1000 + idx * 17}`, validUntil: iso(d) }, file(kind, name));
        const renewal = renewals[`${kind}:${idx}`];
        if (renewal) await this.validity.renew(inst, doc.id, { validUntil: iso(renewal.days), note: 'Renewed lease registered with the sub-registrar.' }, file(kind, name, '-renewed'));
        if (kind === 'structural_safety_certificate' && idx === 12) { // a renewal that was verified: shows the history trail
          await this.validity.renew(inst, doc.id, { validUntil: iso(700) }, file(kind, name, '-renewed'));
          await this.validity.verify(users.officer1, doc.id, { decision: 'approve', note: 'Certificate checked against the issuing authority.' });
        }
      }
    }
  }

  /** Approvals during the seed extend validity; restore the intended illustrative expiry mix. */
  private async setApprovalDates(): Promise<void> {
    for (const [i, inst] of INSTITUTIONS.entries()) {
      if (inst.approvalDays === null) continue;
      await this.db.query('update institutions set approval_valid_until = current_date + $2::int where id=$1', [i + 1, inst.approvalDays]);
    }
  }
}
