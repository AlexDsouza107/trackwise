from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_missing_docs_flagged() -> None:
    r = client.post("/check-documents", json={
        "application_type": "new_course",
        "required_types": ["application_form", "faculty_list"],
        "documents": [{"doc_type": "application_form", "filename": "form.pdf", "size_bytes": 5000}],
    })
    body = r.json()
    assert body["missing"] == ["faculty_list"]
    assert body["completeness_pct"] == 50.0
    assert any(f["code"] == "MISSING_DOCUMENT" for f in body["findings"])


def test_duplicate_and_tiny_files() -> None:
    docs = [
        {"doc_type": "a", "filename": "a.pdf", "size_bytes": 10, "sha256": "x"},
        {"doc_type": "b", "filename": "b.pdf", "size_bytes": 5000, "sha256": "x"},
    ]
    body = client.post("/check-documents", json={"application_type": "t", "required_types": ["a", "b"],
                                                 "documents": docs}).json()
    codes = {f["code"] for f in body["findings"]}
    assert {"TINY_FILE", "DUPLICATE_CONTENT"} <= codes


def test_risk_is_explainable_and_monotonic() -> None:
    low = client.post("/risk-score", json={"application_type": "extension_of_approval",
                                           "compliance_score": 95}).json()
    high = client.post("/risk-score", json={"application_type": "new_institution", "compliance_score": 40,
                                            "missing_documents": 3, "student_faculty_ratio": 28,
                                            "accreditation_days_left": -10}).json()
    assert low["level"] == "low" and high["level"] == "high"
    assert high["risk_score"] > low["risk_score"]
    assert abs(sum(f["points"] for f in high["factors"]) - high["risk_score"]) < 0.3 * len(high["factors"])
