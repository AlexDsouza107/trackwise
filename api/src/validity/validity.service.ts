import { createHash } from 'node:crypto';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { NotificationsService } from '../alerts/notifications.service';
import { assertRegionAccess, effectiveRegion } from '../common/access';
import { AuthUser } from '../common/types';
import { DbService } from '../db/db.service';
import { StorageService } from '../storage/storage.service';

/** Prescribed documents whose validity must be tracked (illustrative list). */
export const VALIDITY_KINDS: Record<string, string> = {
  lease_deed: 'Lease deed',
  fire_safety_certificate: 'Fire safety certificate',
  structural_safety_certificate: 'Structural safety certificate',
  land_use_permission: 'Land-use permission',
};

export const EXPIRING_SOON_DAYS = 90;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
export const AddFields = z.object({ kind: z.enum(Object.keys(VALIDITY_KINDS) as [string, ...string[]]), reference: z.string().max(120).optional(), validUntil: isoDate, institutionId: z.coerce.number().int().optional() });
export const RenewFields = z.object({ validUntil: isoDate, reference: z.string().max(120).optional(), note: z.string().max(500).optional() });
export const VerifyDto = z.object({ decision: z.enum(['approve', 'reject']), note: z.string().max(500).optional() });

interface StoredFile { filename: string; contentType: string; sizeBytes: number; sha256: string; storageKey: string }
interface Renewal extends StoredFile { validUntil: string; reference?: string; note?: string; submittedBy: string; submittedAt: string }
interface Row {
  id: number; institution_id: number; kind: string; reference: string | null; valid_until: Date; filename: string; content_type: string;
  size_bytes: number; sha256: string; storage_key: string; uploaded_at: Date; renewal: Renewal | null;
  verified_at: Date | null; verified_by_name: string | null; history: unknown[];
}

const DAY = 86_400_000;
const today = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

export function statusOf(validUntil: Date, renewalPending: boolean, now = new Date()): 'expired' | 'expiring' | 'valid' | 'renewal_pending' {
  const days = Math.round((validUntil.getTime() - today(now).getTime()) / DAY);
  if (renewalPending) return 'renewal_pending';
  if (days < 0) return 'expired';
  return days <= EXPIRING_SOON_DAYS ? 'expiring' : 'valid';
}

@Injectable()
export class ValidityService {
  constructor(
    private readonly db: DbService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
  ) {}

  private async row(id: number): Promise<Row & { region: string | null; institution_name: string }> {
    const r = await this.db.one<Row & { region: string | null; institution_name: string }>(
      `select d.*, i.region, i.name as institution_name from institution_documents d join institutions i on i.id=d.institution_id where d.id=$1`, [id]);
    if (!r) throw new NotFoundException('Document not found');
    return r;
  }

  private shape(r: Row & { region?: string | null; institution_name?: string }, now = new Date()) {
    const days = Math.round((r.valid_until.getTime() - today(now).getTime()) / DAY);
    return {
      id: r.id, institution_id: r.institution_id, institution_name: r.institution_name, region: r.region ?? null,
      kind: r.kind, kind_label: VALIDITY_KINDS[r.kind] ?? r.kind, reference: r.reference,
      valid_until: r.valid_until.toISOString().slice(0, 10), days_left: days,
      status: statusOf(r.valid_until, !!r.renewal, now),
      filename: r.filename, uploaded_at: r.uploaded_at, verified_at: r.verified_at, verified_by_name: r.verified_by_name,
      renewal: r.renewal ? { validUntil: r.renewal.validUntil, filename: r.renewal.filename, submittedBy: r.renewal.submittedBy, submittedAt: r.renewal.submittedAt, note: r.renewal.note ?? null } : null,
      history: r.history,
    };
  }

  async list(user: AuthUser, f: { status?: string; region?: string; institutionId?: number } = {}) {
    const params: unknown[] = [];
    const where: string[] = [];
    if (user.role === 'institution') { params.push(user.institutionId); where.push(`d.institution_id=$${params.length}`); }
    else if (f.institutionId) { params.push(f.institutionId); where.push(`d.institution_id=$${params.length}`); }
    const region = effectiveRegion(user, f.region);
    if (region) { params.push(region); where.push(`i.region=$${params.length}`); }
    const rows = await this.db.query<Row & { region: string | null; institution_name: string }>(
      `select d.*, i.region, i.name as institution_name from institution_documents d join institutions i on i.id=d.institution_id
        ${where.length ? 'where ' + where.join(' and ') : ''} order by d.valid_until asc, d.id`, params);
    const now = new Date();
    const shaped = rows.map((r) => this.shape(r, now));
    return f.status ? shaped.filter((r) => r.status === f.status) : shaped;
  }

  private async store(instId: number, kind: string, file: { originalname: string; mimetype: string; buffer: Buffer }): Promise<StoredFile> {
    const storageKey = `institution-docs/${instId}/${kind}/${Date.now()}-${file.originalname.replace(/[^\w.-]/g, '_')}`;
    await this.storage.put(storageKey, file.buffer, file.mimetype || 'application/octet-stream');
    return {
      filename: file.originalname, contentType: file.mimetype || 'application/octet-stream', sizeBytes: file.buffer.length,
      sha256: createHash('sha256').update(file.buffer).digest('hex'), storageKey,
    };
  }

  async add(user: AuthUser, input: z.infer<typeof AddFields>, file: { originalname: string; mimetype: string; buffer: Buffer }, at = new Date()) {
    const instId = user.role === 'institution' ? user.institutionId : input.institutionId;
    if (!instId || (user.role !== 'institution' && user.role !== 'admin')) throw new ForbiddenException('Only the institution (or an admin) registers documents');
    const exists = await this.db.one('select 1 from institution_documents where institution_id=$1 and kind=$2', [instId, input.kind]);
    if (exists) throw new BadRequestException('This document is already registered. Submit a renewal instead.');
    const f = await this.store(instId, input.kind, file);
    const row = await this.db.one<{ id: number }>(
      `insert into institution_documents (institution_id, kind, reference, valid_until, filename, content_type, size_bytes, sha256, storage_key, uploaded_by, uploaded_at, history)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
      [instId, input.kind, input.reference ?? null, input.validUntil, f.filename, f.contentType, f.sizeBytes, f.sha256, f.storageKey, user.id || null, at,
        JSON.stringify([{ at: at.toISOString(), actor: user.name, event: 'REGISTERED', validUntil: input.validUntil }])]);
    return this.shape(await this.row(row!.id));
  }

  async renew(user: AuthUser, id: number, input: z.infer<typeof RenewFields>, file: { originalname: string; mimetype: string; buffer: Buffer }, at = new Date()) {
    const d = await this.row(id);
    if (user.role !== 'institution' || user.institutionId !== d.institution_id) throw new ForbiddenException();
    if (d.renewal) throw new BadRequestException('A renewal is already awaiting verification');
    if (new Date(`${input.validUntil}T00:00:00Z`).getTime() <= d.valid_until.getTime()) {
      throw new BadRequestException('The renewed document must be valid beyond the current expiry date');
    }
    const f = await this.store(d.institution_id, d.kind, file);
    const renewal: Renewal = { ...f, validUntil: input.validUntil, reference: input.reference, note: input.note, submittedBy: user.name, submittedAt: at.toISOString() };
    await this.db.query(
      `update institution_documents set renewal=$2, history = history || $3::jsonb where id=$1`,
      [id, JSON.stringify(renewal), JSON.stringify([{ at: at.toISOString(), actor: user.name, event: 'RENEWAL_SUBMITTED', validUntil: input.validUntil, note: input.note }])]);
    const body = `${d.institution_name} submitted a renewed ${VALIDITY_KINDS[d.kind] ?? d.kind} (valid to ${input.validUntil}). Verify it.`;
    const n = { kind: 'DOCUMENT_RENEWAL', title: `Renewal to verify: ${VALIDITY_KINDS[d.kind] ?? d.kind}`, body, link: '/documents' };
    await this.notifications.notifyRole('regional', n, d.region);
    await this.notifications.notifyRole('officer', n);
    return this.shape(await this.row(id));
  }

  async verify(user: AuthUser, id: number, input: z.infer<typeof VerifyDto>, at = new Date()) {
    const d = await this.row(id);
    if (!['officer', 'regional', 'admin'].includes(user.role)) throw new ForbiddenException();
    assertRegionAccess(user, d.region);
    if (!d.renewal) throw new BadRequestException('There is no renewal awaiting verification');
    const label = VALIDITY_KINDS[d.kind] ?? d.kind;
    if (input.decision === 'approve') {
      const r = d.renewal;
      await this.db.query(
        `update institution_documents set valid_until=$2, reference=coalesce($3, reference), filename=$4, content_type=$5, size_bytes=$6, sha256=$7,
                storage_key=$8, renewal=null, verified_at=$9, verified_by_name=$10, history = history || $11::jsonb where id=$1`,
        [id, r.validUntil, r.reference ?? null, r.filename, r.contentType, r.sizeBytes, r.sha256, r.storageKey, at, user.name,
          JSON.stringify([{ at: at.toISOString(), actor: user.name, event: 'RENEWAL_VERIFIED', validUntil: r.validUntil, note: input.note, previousValidUntil: d.valid_until.toISOString().slice(0, 10) }])]);
      await this.notifications.notifyInstitution(d.institution_id, {
        kind: 'DOCUMENT_RENEWAL', title: `${label} renewal verified`, link: '/documents', email: true,
        body: `Your renewed ${label} is verified and valid until ${r.validUntil}.`,
      });
    } else {
      if (!input.note?.trim()) throw new BadRequestException('A reason is required to reject a renewal');
      await this.storage.delete(d.renewal.storageKey).catch(() => undefined);
      await this.db.query(
        `update institution_documents set renewal=null, history = history || $2::jsonb where id=$1`,
        [id, JSON.stringify([{ at: at.toISOString(), actor: user.name, event: 'RENEWAL_REJECTED', note: input.note }])]);
      await this.notifications.notifyInstitution(d.institution_id, {
        kind: 'DOCUMENT_RENEWAL', severity: 'warning', title: `${label} renewal rejected`, link: '/documents', email: true,
        body: `Your renewal was not accepted: ${input.note}`,
      });
    }
    return this.shape(await this.row(id));
  }

  async file(user: AuthUser, id: number, which: 'current' | 'renewal') {
    const d = await this.row(id);
    if (user.role === 'institution' && user.institutionId !== d.institution_id) throw new ForbiddenException();
    assertRegionAccess(user, d.region);
    const f = which === 'renewal' ? d.renewal : { filename: d.filename, contentType: d.content_type, storageKey: d.storage_key };
    if (!f) throw new NotFoundException('No such file');
    return { filename: f.filename, contentType: f.contentType, buffer: await this.storage.get(f.storageKey) };
  }
}
