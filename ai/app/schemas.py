from typing import Literal

from pydantic import BaseModel, Field

Severity = Literal["info", "warning", "critical"]


class DocumentIn(BaseModel):
    doc_type: str
    filename: str
    size_bytes: int = Field(ge=0)
    sha256: str | None = None
    content_type: str | None = None


class DocumentCheckRequest(BaseModel):
    application_type: str
    required_types: list[str]
    documents: list[DocumentIn]


class Finding(BaseModel):
    severity: Severity
    code: str
    message: str
    doc_type: str | None = None


class DocumentCheckResponse(BaseModel):
    completeness_pct: float
    missing: list[str]
    findings: list[Finding]
    model_version: str


class RiskRequest(BaseModel):
    application_type: str
    intake_increase_pct: float | None = None
    student_faculty_ratio: float | None = None
    compliance_score: float | None = Field(default=None, ge=0, le=100)
    missing_documents: int = Field(default=0, ge=0)
    prior_deficiencies: int = Field(default=0, ge=0)
    fee_to_cap_ratio: float | None = None
    accreditation_days_left: int | None = None


class RiskFactor(BaseModel):
    feature: str
    label: str
    points: float
    detail: str


class RiskResponse(BaseModel):
    risk_score: float
    level: Literal["low", "medium", "high"]
    factors: list[RiskFactor]
    model_version: str
