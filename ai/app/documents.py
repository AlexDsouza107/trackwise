"""Rules-based document completeness and sanity checks (explainable, no ML)."""
from collections import defaultdict

from .schemas import DocumentCheckRequest, DocumentCheckResponse, Finding

MODEL_VERSION = "doc-rules-1.0"
ALLOWED_EXT = {"pdf", "png", "jpg", "jpeg", "docx", "xlsx"}
MIN_PLAUSIBLE_BYTES = 200  # anything smaller is almost certainly an empty/placeholder file


def _ext(filename: str) -> str:
    return filename.rsplit(".", 1)[-1].lower() if "." in filename else ""


def check_documents(req: DocumentCheckRequest) -> DocumentCheckResponse:
    findings: list[Finding] = []
    present = {d.doc_type for d in req.documents}
    missing = [t for t in req.required_types if t not in present]

    for t in missing:
        findings.append(Finding(severity="critical", code="MISSING_DOCUMENT",
                                message=f"Required document '{t}' has not been uploaded.", doc_type=t))

    for d in req.documents:
        if d.doc_type not in req.required_types:
            findings.append(Finding(severity="info", code="UNEXPECTED_DOCUMENT",
                                    message=f"'{d.doc_type}' is not required for {req.application_type}.",
                                    doc_type=d.doc_type))
        if _ext(d.filename) not in ALLOWED_EXT:
            findings.append(Finding(severity="warning", code="UNSUPPORTED_FORMAT",
                                    message=f"{d.filename}: unsupported or missing file extension.",
                                    doc_type=d.doc_type))
        if d.size_bytes < MIN_PLAUSIBLE_BYTES:
            findings.append(Finding(severity="warning", code="TINY_FILE",
                                    message=f"{d.filename} is only {d.size_bytes} bytes; likely empty or corrupt.",
                                    doc_type=d.doc_type))

    by_hash: dict[str, set[str]] = defaultdict(set)
    for d in req.documents:
        if d.sha256:
            by_hash[d.sha256].add(d.doc_type)
    for types in by_hash.values():
        if len(types) > 1:
            findings.append(Finding(severity="warning", code="DUPLICATE_CONTENT",
                                    message="Identical file uploaded for multiple document types: "
                                            + ", ".join(sorted(types)) + "."))

    total = len(req.required_types)
    pct = 100.0 if total == 0 else round(100.0 * (total - len(missing)) / total, 1)
    return DocumentCheckResponse(completeness_pct=pct, missing=missing, findings=findings,
                                 model_version=MODEL_VERSION)
