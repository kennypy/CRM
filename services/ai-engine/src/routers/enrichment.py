"""
Data enrichment router — enriches contacts and companies with external data.
Uses company domain/website to look up public data and AI to infer additional fields.
"""

import os
import httpx
import structlog
from uuid import UUID
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional

from ..db import get_pool
from ..config import settings

log = structlog.get_logger()
router = APIRouter()

GRAPH_CORE_URL = os.getenv("GRAPH_CORE_URL", "http://localhost:4002")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")


class EnrichRequest(BaseModel):
    tenant_id: str
    source: str = "internal"


class BatchEnrichRequest(BaseModel):
    tenant_id: str
    entity_type: str
    entity_ids: list[str]


@router.post("/enrich/{entity_type}/{entity_id}")
async def enrich_entity(
    entity_type: str,
    entity_id: str,
    request: EnrichRequest,
):
    """Enrich a single entity with external data."""
    pool = await get_pool()
    tenant_id = request.tenant_id

    # Create enrichment job record
    async with pool.acquire() as conn:
        job = await conn.fetchrow(
            """INSERT INTO enrichment_jobs (tenant_id, entity_type, entity_id, provider, status)
               VALUES ($1, $2, $3, $4, 'processing')
               RETURNING id""",
            tenant_id, entity_type, entity_id, request.source,
        )
        job_id = str(job["id"])

    try:
        # Fetch current entity data from graph-core
        endpoint = {
            "contact": "contacts",
            "company": "companies",
            "deal": "deals",
        }.get(entity_type, entity_type)

        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                f"{GRAPH_CORE_URL}/{endpoint}/{entity_id}",
                params={"tenantId": tenant_id},
                headers={"x-tenant-id": tenant_id},
            )
            if resp.status_code != 200:
                raise HTTPException(status_code=404, detail="Entity not found")

            entity_data = resp.json().get("data", {})

        # Determine what to enrich based on entity type
        enriched_data = {}
        confidence = 0.0

        if entity_type == "company":
            domain = entity_data.get("website") or entity_data.get("domain") or ""
            company_name = entity_data.get("name", "")

            if domain or company_name:
                enriched_data, confidence = await _enrich_company(company_name, domain)

        elif entity_type == "contact":
            email = entity_data.get("email", "")
            name = entity_data.get("name", "")
            company = entity_data.get("company", "")

            if email or name:
                enriched_data, confidence = await _enrich_contact(name, email, company)

        # Write enriched data back to graph-core
        if enriched_data:
            async with httpx.AsyncClient(timeout=10.0) as client:
                await client.patch(
                    f"{GRAPH_CORE_URL}/{endpoint}/{entity_id}",
                    params={"tenantId": tenant_id},
                    headers={"x-tenant-id": tenant_id, "Content-Type": "application/json"},
                    json=enriched_data,
                )

        # Update enrichment job
        async with pool.acquire() as conn:
            await conn.execute(
                """UPDATE enrichment_jobs
                   SET status = 'completed', result_data = $1, confidence = $2, completed_at = NOW()
                   WHERE id = $3""",
                enriched_data, confidence, job_id,
            )

        return {
            "success": True,
            "data": {
                "jobId": job_id,
                "entityType": entity_type,
                "entityId": entity_id,
                "enrichedFields": list(enriched_data.keys()),
                "confidence": confidence,
            },
        }

    except Exception as e:
        async with pool.acquire() as conn:
            await conn.execute(
                """UPDATE enrichment_jobs SET status = 'failed', completed_at = NOW() WHERE id = $1""",
                job_id,
            )
        log.error("enrichment.failed", entity_type=entity_type, entity_id=entity_id, error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/enrich/batch")
async def batch_enrich(request: BatchEnrichRequest):
    """Enrich multiple entities. Returns immediately with job IDs."""
    pool = await get_pool()
    jobs = []

    for eid in request.entity_ids[:50]:  # Limit to 50 per batch
        async with pool.acquire() as conn:
            job = await conn.fetchrow(
                """INSERT INTO enrichment_jobs (tenant_id, entity_type, entity_id, status)
                   VALUES ($1, $2, $3, 'pending')
                   RETURNING id""",
                request.tenant_id, request.entity_type, eid,
            )
            jobs.append({"jobId": str(job["id"]), "entityId": eid})

    # In production, enqueue to BullMQ/Redis for async processing
    return {"success": True, "data": {"jobs": jobs, "total": len(jobs)}}


async def _enrich_company(name: str, domain: str) -> tuple[dict, float]:
    """Enrich company data using AI inference from available information."""
    enriched = {}
    confidence = 0.5

    if not ANTHROPIC_API_KEY:
        return enriched, 0.0

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": ANTHROPIC_API_KEY,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": "claude-haiku-4-5-20251001",
                    "max_tokens": 500,
                    "messages": [{
                        "role": "user",
                        "content": f"""Given a company named "{name}" with website "{domain}",
                        provide likely company information in JSON format with these fields:
                        industry, employee_count_range, founding_year, headquarters_city,
                        headquarters_country, description (1 sentence).
                        Only include fields you're reasonably confident about.
                        Return ONLY valid JSON, no markdown.""",
                    }],
                },
            )
            if resp.status_code == 200:
                data = resp.json()
                text = data.get("content", [{}])[0].get("text", "{}")
                import json
                enriched = json.loads(text)
                confidence = 0.7
    except Exception as e:
        log.warning("enrichment.ai_error", error=str(e))

    return enriched, confidence


async def _enrich_contact(name: str, email: str, company: str) -> tuple[dict, float]:
    """Enrich contact data using AI inference."""
    enriched = {}
    confidence = 0.5

    # Extract domain from email for company association
    if email and "@" in email:
        domain = email.split("@")[1]
        if domain not in ("gmail.com", "yahoo.com", "hotmail.com", "outlook.com"):
            enriched["company_domain"] = domain

    if not ANTHROPIC_API_KEY:
        return enriched, confidence

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": ANTHROPIC_API_KEY,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": "claude-haiku-4-5-20251001",
                    "max_tokens": 300,
                    "messages": [{
                        "role": "user",
                        "content": f"""Given a person named "{name}" at company "{company}" with email "{email}",
                        provide likely information in JSON format with these fields:
                        likely_title, likely_department, seniority_level.
                        Only include fields you're reasonably confident about.
                        Return ONLY valid JSON, no markdown.""",
                    }],
                },
            )
            if resp.status_code == 200:
                data = resp.json()
                text = data.get("content", [{}])[0].get("text", "{}")
                import json
                ai_data = json.loads(text)
                enriched.update(ai_data)
                confidence = 0.6
    except Exception as e:
        log.warning("enrichment.ai_error", error=str(e))

    return enriched, confidence
