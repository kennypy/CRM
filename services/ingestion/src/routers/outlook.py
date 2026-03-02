"""
Outlook / Microsoft Graph ingestion router.
Handles Microsoft Graph change notification webhooks.
"""

import json
import structlog
from fastapi import APIRouter, Request, Response
from pydantic import BaseModel

from ..config import settings

router = APIRouter()
log = structlog.get_logger()


@router.post("/notifications")
async def outlook_notifications(request: Request):
    """
    Microsoft Graph webhook endpoint.
    Handles both validation (GET with validationToken) and change notifications (POST).
    """
    # Validation handshake
    validation_token = request.query_params.get("validationToken")
    if validation_token:
        return Response(content=validation_token, media_type="text/plain")

    body = await request.json()
    log.info("outlook.notification_received", count=len(body.get("value", [])))

    # TODO: Process each changed resource, fetch from Microsoft Graph, publish to stream
    return {"status": "ok"}
