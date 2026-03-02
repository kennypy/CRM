from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()


class ManualExtractionRequest(BaseModel):
    text: str
    activity_type: str = "email"
    subject: str | None = None
    tenant_id: str


@router.post("/manual")
async def manual_extraction(request: ManualExtractionRequest):
    """
    Trigger a manual extraction on ad-hoc text.
    Used for testing and by the review queue editor.
    """
    from ..workers.extraction_worker import _extract_with_llm, _compute_overall_confidence
    result = await _extract_with_llm(
        activity_type=request.activity_type,
        subject=request.subject,
        body=request.text,
    )
    confidence = _compute_overall_confidence(result) if result else 0.0
    return {"extraction": result, "confidence": confidence}
