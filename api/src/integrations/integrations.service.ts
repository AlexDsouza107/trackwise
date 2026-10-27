import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { simplePdf } from '../seed/pdf';

/**
 * Adapters to external authorised systems. Both are MOCKS: they return deterministic, clearly-labelled demo data and call
 * nothing. Each sits behind a small interface so a real client can replace it without touching the workflow.
 */
export interface IntegrationInfo { key: string; name: string; mode: 'mock' | 'stub'; description: string }

export const DIGILOCKER_SOURCE = 'DigiLocker (mock)';
/** Document types an institution can pull from a digital locker instead of uploading. */
export const DIGILOCKER_TYPES: Record<string, string> = {
  society_registration: 'Society / trust registration certificate',
  land_documents: 'Land records',
  accreditation_certificate: 'Accreditation certificate',
  previous_approval_letter: 'Previous approval letter',
  audited_accounts: 'Audited accounts',
  financial_solvency: 'Financial solvency certificate',
};

export interface RegistryRecord { source: string; status: 'accredited' | 'lapsed' | 'not_found'; validUntil: string | null; grade: string | null }

@Injectable()
export class IntegrationsService {
  constructor(private readonly db: DbService) {}

  list(): IntegrationInfo[] {
    return [
      { key: 'digilocker', name: DIGILOCKER_SOURCE, mode: 'mock', description: 'Fetches issued documents by reference number instead of manual upload.' },
      { key: 'accreditation_registry', name: 'Accreditation registry (mock)', mode: 'mock', description: 'Cross-checks accreditation validity recorded by the institution.' },
      { key: 'email', name: 'E-mail gateway', mode: 'stub', description: 'Messages are queued to an outbox table and logged; no SMTP is configured.' },
    ];
  }

  /** Simulates fetching an issued document. References ending in 000 simulate "not found". */
  fetchDocument(docType: string, referenceId: string, institutionName: string) {
    if (!DIGILOCKER_TYPES[docType]) throw new BadRequestException(`"${docType}" cannot be fetched from DigiLocker`);
    if (!/^[A-Za-z0-9-]{6,24}$/.test(referenceId)) throw new BadRequestException('Reference must be 6-24 letters, digits or hyphens');
    if (referenceId.endsWith('000')) throw new NotFoundException(`No ${DIGILOCKER_TYPES[docType].toLowerCase()} found for reference ${referenceId}`);
    const buffer = simplePdf([
      'ILLUSTRATIVE DEMO DOCUMENT - FETCHED VIA A MOCK DIGILOCKER ADAPTER', '',
      `Document: ${DIGILOCKER_TYPES[docType]}`, `Reference: ${referenceId}`, `Holder: ${institutionName}`,
      'Issuer: Demo Issuing Authority (fictitious)', 'Verification: signature check simulated (always passes)',
    ]);
    return { filename: `${docType}-${referenceId}.pdf`, contentType: 'application/pdf', buffer, source: DIGILOCKER_SOURCE };
  }

  /** Registry view of an institution's accreditation. The mock deliberately disagrees for DEMO-0003 to show a mismatch. */
  async accreditation(institutionId: number) {
    const inst = await this.db.one<{ code: string; name: string; region: string | null }>('select code, name, region from institutions where id=$1', [institutionId]);
    if (!inst) throw new NotFoundException('Institution not found');
    const m = await this.db.one<{ accreditation_valid_until: Date | null }>(
      'select accreditation_valid_until from institution_metrics where institution_id=$1 order by period desc limit 1', [institutionId]);
    const recorded = m?.accreditation_valid_until ?? null;
    let registry: RegistryRecord;
    if (!recorded) {
      registry = { source: 'Accreditation registry (mock)', status: 'not_found', validUntil: null, grade: null };
    } else {
      const skew = inst.code === 'DEMO-0003' ? -20 * 86_400_000 : 0;
      const until = new Date(recorded.getTime() + skew);
      registry = {
        source: 'Accreditation registry (mock)', status: until.getTime() < Date.now() ? 'lapsed' : 'accredited',
        validUntil: until.toISOString().slice(0, 10), grade: ['A', 'A+', 'B+'][inst.code.charCodeAt(inst.code.length - 1) % 3],
      };
    }
    const recordedIso = recorded ? recorded.toISOString().slice(0, 10) : null;
    return {
      institution: { id: institutionId, name: inst.name, code: inst.code }, registry, recorded: recordedIso,
      match: registry.validUntil === recordedIso,
      differenceDays: registry.validUntil && recordedIso ? Math.round((new Date(registry.validUntil).getTime() - new Date(recordedIso).getTime()) / 86_400_000) : null,
    };
  }
}
