from fastapi import APIRouter
from datetime import datetime

router = APIRouter()


@router.get("/health")
async def health():
    return {"status": "ok", "service": "ai-engine", "timestamp": datetime.utcnow().isoformat()}
