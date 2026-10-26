import { Injectable, Logger } from '@nestjs/common';
import { config } from '../config';

export interface DocCheckResult {
  completeness_pct: number;
  missing: string[];
  findings: { severity: 'info' | 'warning' | 'critical'; code: string; message: string; doc_type?: string | null }[];
  model_version: string;
}

export interface RiskResult {
  risk_score: number;
  level: 'low' | 'medium' | 'high';
  factors: { feature: string; label: string; points: number; detail: string }[];
  model_version: string;
}

export interface RiskInput {
  application_type: string;
  intake_increase_pct?: number | null;
  student_faculty_ratio?: number | null;
  compliance_score?: number | null;
  missing_documents: number;
  prior_deficiencies: number;
  fee_to_cap_ratio?: number | null;
  accreditation_days_left?: number | null;
}

/** Thin client for the FastAPI service. Failures degrade to null so workflow never blocks on AI. */
@Injectable()
export class AiClient {
  private readonly log = new Logger('AiClient');

  private async post<T>(path: string, body: unknown): Promise<T | null> {
    try {
      const res = await fetch(`${config.aiUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as T;
    } catch (err) {
      this.log.warn(`AI call ${path} failed: ${(err as Error).message}`);
      return null;
    }
  }

  checkDocuments(body: {
    application_type: string;
    required_types: string[];
    documents: { doc_type: string; filename: string; size_bytes: number; sha256: string; content_type: string }[];
  }) {
    return this.post<DocCheckResult>('/check-documents', body);
  }

  scoreRisk(body: RiskInput) {
    return this.post<RiskResult>('/risk-score', body);
  }
}
