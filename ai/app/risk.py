"""Additive, explainable risk model. Every point added is reported as a factor."""
from .schemas import RiskFactor, RiskRequest, RiskResponse

MODEL_VERSION = "risk-additive-1.0"
BASE_POINTS = 10.0
TYPE_BASE = {"new_institution": 8.0, "new_course": 3.0, "intake_increase": 4.0, "extension_of_approval": 0.0}


def _add(factors: list[RiskFactor], feature: str, label: str, points: float, detail: str) -> None:
    if points > 0:
        factors.append(RiskFactor(feature=feature, label=label, points=round(points, 1), detail=detail))


def score_risk(req: RiskRequest) -> RiskResponse:
    factors: list[RiskFactor] = []
    _add(factors, "type", "Application type", TYPE_BASE.get(req.application_type, 2.0),
         f"Base uncertainty for '{req.application_type}'.")

    _add(factors, "missing_documents", "Missing documents", min(32.0, 8.0 * req.missing_documents),
         f"{req.missing_documents} required document(s) missing (8 pts each, capped at 32).")

    if req.compliance_score is not None:
        cs = req.compliance_score
        pts = 25.0 if cs < 50 else 15.0 if cs < 70 else 6.0 if cs < 85 else 0.0
        _add(factors, "compliance_score", "Low compliance score", pts, f"Compliance score {cs:.0f}/100.")

    if req.student_faculty_ratio is not None and req.student_faculty_ratio > 20:
        pts = min(20.0, (req.student_faculty_ratio - 20) * 3)
        _add(factors, "faculty_ratio", "High student:faculty ratio", pts,
             f"Ratio {req.student_faculty_ratio:.1f}:1 exceeds the illustrative 20:1 norm.")

    if req.intake_increase_pct is not None:
        p = req.intake_increase_pct
        pts = 28.0 if p > 100 else 20.0 if p > 50 else 10.0 if p > 25 else 0.0
        _add(factors, "intake_increase", "Large intake increase", pts, f"Requested intake rises by {p:.0f}%.")

    if req.fee_to_cap_ratio is not None and req.fee_to_cap_ratio > 0.9:
        r = req.fee_to_cap_ratio
        pts = min(20.0, (r - 1) * 100 + 4) if r > 1 else 4.0
        _add(factors, "fee", "Fee near/above cap", pts, f"Proposed fee is {r * 100:.0f}% of the illustrative cap.")

    if req.accreditation_days_left is not None:
        d = req.accreditation_days_left
        pts = 20.0 if d < 0 else 8.0 if d < 180 else 0.0
        _add(factors, "accreditation", "Accreditation validity", pts,
             "Accreditation has lapsed." if d < 0 else f"Accreditation valid for only {d} more day(s).")

    _add(factors, "prior_deficiencies", "Prior deficiencies", min(15.0, 5.0 * req.prior_deficiencies),
         f"{req.prior_deficiencies} deficiency round(s) already raised (5 pts each, capped at 15).")

    raw = BASE_POINTS + sum(f.points for f in factors)
    score = min(100.0, raw)
    if raw > 100.0:
        factors.append(RiskFactor(feature="cap", label="Score cap", points=round(100.0 - raw, 1),
                                  detail="Scores are capped at 100."))
    level = "low" if score < 35 else "medium" if score < 65 else "high"
    factors.insert(0, RiskFactor(feature="base", label="Baseline", points=BASE_POINTS,
                                 detail="Every application starts with a small baseline."))
    return RiskResponse(risk_score=round(score, 1), level=level, factors=factors, model_version=MODEL_VERSION)
