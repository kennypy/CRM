from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

router = APIRouter()


class ManualExtractionRequest(BaseModel):
    text: str
    activity_type: str = "email"
    subject: str | None = None
    # H-AI5: non-authoritative. Tenant is taken from the verified x-tenant-id header;
    # a body tenant_id must match the header or the request is rejected (403).
    tenant_id: str | None = None


@router.post("/manual")
async def manual_extraction(
    request: ManualExtractionRequest,
    x_tenant_id: str | None = Header(default=None),
):
    """
    Trigger a manual extraction on ad-hoc text.
    Used for testing and by the review queue editor.
    """
    # H-AI5: derive tenant from the gateway-set header, never from the request body.
    header_tenant = (x_tenant_id or "").strip()
    if not header_tenant:
        raise HTTPException(status_code=403, detail="Tenant context missing")
    if request.tenant_id and request.tenant_id.strip() and request.tenant_id.strip() != header_tenant:
        raise HTTPException(status_code=403, detail="Tenant mismatch")
    from ..workers.extraction_worker import _extract_with_llm, _compute_overall_confidence
    result = await _extract_with_llm(
        activity_type=request.activity_type,
        subject=request.subject,
        body=request.text,
    )
    confidence = _compute_overall_confidence(result) if result else 0.0
    return {"extraction": result, "confidence": confidence}
