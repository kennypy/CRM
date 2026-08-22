from datetime import datetime, timezone

from fastapi import APIRouter


def make_health_router(service_name: str) -> APIRouter:
    router = APIRouter()

    @router.get("/health")
    async def health():
        return {
            "status": "ok",
            "service": service_name,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    return router
