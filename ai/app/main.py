from fastapi import FastAPI

from .documents import check_documents
from .risk import score_risk
from .schemas import DocumentCheckRequest, DocumentCheckResponse, RiskRequest, RiskResponse

app = FastAPI(title="TrackWise AI service", version="1.0.0",
              description="Document completeness checks and explainable risk scoring (rules-based demo).")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/check-documents", response_model=DocumentCheckResponse)
def post_check_documents(req: DocumentCheckRequest) -> DocumentCheckResponse:
    return check_documents(req)


@app.post("/risk-score", response_model=RiskResponse)
def post_risk_score(req: RiskRequest) -> RiskResponse:
    return score_risk(req)
