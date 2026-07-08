"""
Reality Score + Lead Scoring Router
====================================
Factors (configurable weights per tenant):
  - Activity recency    (0.30): days since last email/call/meeting on this deal
  - Engagement breadth  (0.25): % of unique contacts active in last 14 days
  - Sentiment trend     (0.20): rolling sentiment from last 5 activity events
  - Close date proximity(0.15): time remaining vs expected sales cycle (90d)
  - Budget confirmation (0.10): was budget explicitly mentioned?

Scores are computed from the crm_events table (written by every graph-core mutation).
Deal metadata (close_date, stage, value) is passed in the request body by the gateway
so we avoid an extra round-trip.
"""

from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from typing import Optional

import asyncpg
import structlog
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from ..db import get_pool

log = structlog.get_logger()
router = APIRouter()

# ── Weights ───────────────────────────────────────────────────────────────────

WEIGHTS = {
    "recency":   0.30,
    "breadth":   0.25,
    "sentiment": 0.20,
    "proximity": 0.15,
    "budget":    0.10,
}

BUDGET_KEYWORDS = frozenset([
    "budget", "approved", "allocated", "sign off", "signed off",
    "po issued", "purchase order", "legal approved", "procurement",
    "funds available", "funding confirmed",
])


# ── Request / response schemas ────────────────────────────────────────────────

class RealityScoreRequest(BaseModel):
    deal_id: str
    # H-AI5: non-authoritative. Tenant is derived from the verified x-tenant-id
    # header; a body tenant_id must match the header or the request is rejected.
    tenant_id: str | None = None
    # Optional deal context passed from the gateway to avoid a graph round-trip
    close_date: Optional[str] = None   # ISO-8601 date or datetime
    stage: Optional[str] = None
    value: Optional[float] = None


class ScoreFactor(BaseModel):
    name: str
    weight: float
    score: float
    evidence: str


class RealityScoreResponse(BaseModel):
    deal_id: str
    score: int
    trend: str         # "up" | "down" | "flat"
    trend_delta: int
    explanation: str
    factors: list[ScoreFactor]
    computed_at: str


# ── Scoring helpers ───────────────────────────────────────────────────────────

def _recency_score(last_activity_at: datetime | None) -> tuple[float, str]:
    """Exponential decay: 100 at 0 days → ~14 at 7 days (half-life ≈ 3.5d)."""
    if last_activity_at is None:
        return 0.0, "No activity recorded"
    now = datetime.now(timezone.utc)
    if last_activity_at.tzinfo is None:
        last_activity_at = last_activity_at.replace(tzinfo=timezone.utc)
    days = (now - last_activity_at).total_seconds() / 86_400
    score = max(0.0, 100.0 * math.exp(-days / 5))
    label = f"{int(days)}d ago" if days >= 1 else "Today"
    return round(score, 1), f"Last contact {label}"


def _breadth_score(recent: int, total: int) -> tuple[float, str]:
    if total == 0:
        return 50.0, "No contacts linked to deal"
    pct = min(1.0, recent / total)
    return round(pct * 100, 1), f"{recent}/{total} contacts active in last 14 days"


def _sentiment_score(sentiments: list[str]) -> tuple[float, str]:
    MAP = {"positive": 100, "neutral": 55, "negative": 10}
    if not sentiments:
        return 55.0, "No sentiment data"
    values = [MAP.get(s, 55) for s in sentiments]
    avg = sum(values) / len(values)
    dominant = max(set(sentiments), key=sentiments.count)
    return round(avg, 1), f"Dominant: {dominant} (last {len(sentiments)} activities)"


def _proximity_score(close_date_str: str | None) -> tuple[float, str]:
    if not close_date_str:
        return 50.0, "No close date set"
    try:
        close = datetime.fromisoformat(close_date_str.replace("Z", "+00:00"))
        if close.tzinfo is None:
            close = close.replace(tzinfo=timezone.utc)
        days = (close - datetime.now(timezone.utc)).days
    except (ValueError, TypeError):
        return 50.0, "Invalid close date"

    if days < 0:
        return max(0.0, 20.0 + days * 2), f"Overdue by {abs(days)} days"
    if days <= 7:
        return 65.0, f"{days}d remaining — imminent"
    if days <= 30:
        return 85.0, f"{days}d remaining — on track"
    if days <= 90:
        return 70.0, f"{days}d remaining"
    return 50.0, f"{days}d remaining — early stage"


def _budget_score(texts: list[str]) -> tuple[float, str]:
    combined = " ".join(texts).lower()
    found = next((kw for kw in BUDGET_KEYWORDS if kw in combined), None)
    if found:
        return 100.0, f"Budget signal: '{found}'"
    return 0.0, "No budget confirmation detected"


def _weighted_total(factors: dict[str, float]) -> int:
    return max(0, min(100, round(sum(factors[k] * WEIGHTS[k] for k in WEIGHTS))))


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/reality-score", response_model=RealityScoreResponse)
async def calculate_reality_score(
    req: RealityScoreRequest,
    x_tenant_id: str | None = Header(default=None),
):
    pool: asyncpg.Pool = await get_pool()

    # H-AI5: tenant comes from the gateway-set header (derived from the verified
    # JWT), never the request body. A body tenant_id is allowed only if it matches.
    tenant_id = (x_tenant_id or "").strip()
    if not tenant_id:
        raise HTTPException(status_code=403, detail="Tenant context missing")
    if req.tenant_id and req.tenant_id.strip() and req.tenant_id.strip() != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")

    recency_val = breadth_val = sentiment_val = budget_val = 50.0
    recency_ev = breadth_ev = sentiment_ev = budget_ev = "No data"
    trend, trend_delta = "flat", 0

    try:
        async with pool.acquire() as conn:
            # All deal events in last 30 days
            rows = await conn.fetch(
                """
                SELECT event_type, payload, created_at FROM crm_events
                WHERE tenant_id = $1::uuid
                  AND entity_id = $2::uuid
                  AND created_at > NOW() - INTERVAL '30 days'
                ORDER BY created_at DESC
                LIMIT 100
                """,
                tenant_id, req.deal_id,
            )

            activity_rows = [r for r in rows if r["event_type"].startswith("activity.")]

            # Factor 1: Recency
            last_at = activity_rows[0]["created_at"] if activity_rows else None
            recency_val, recency_ev = _recency_score(last_at)

            # Factor 2: Engagement breadth — unique participant IDs in payloads
            now_ts = datetime.now(timezone.utc).timestamp()
            all_p: set[str] = set()
            recent_p: set[str] = set()
            event_texts: list[str] = []

            for r in rows:
                payload = r["payload"] or {}
                if isinstance(payload, str):
                    payload = json.loads(payload)
                pids = payload.get("participant_ids", [])
                all_p.update(pids)
                if r["created_at"] and (now_ts - r["created_at"].timestamp()) < 14 * 86_400:
                    recent_p.update(pids)
                body = payload.get("body_text") or payload.get("summary") or ""
                if body:
                    event_texts.append(body[:400])

            breadth_val, breadth_ev = _breadth_score(len(recent_p), len(all_p))

            # Factor 3: Sentiment from last 5 activity payloads
            sentiments: list[str] = []
            for r in activity_rows[:5]:
                payload = r["payload"] or {}
                if isinstance(payload, str):
                    payload = json.loads(payload)
                s = payload.get("sentiment")
                if s:
                    sentiments.append(s)
            sentiment_val, sentiment_ev = _sentiment_score(sentiments)

            # Factor 5: Budget — scan 90 days of activity body texts
            old_rows = await conn.fetch(
                """
                SELECT payload FROM crm_events
                WHERE tenant_id = $1::uuid
                  AND entity_id = $2::uuid
                  AND created_at > NOW() - INTERVAL '90 days'
                  AND event_type = 'activity.created'
                LIMIT 50
                """,
                tenant_id, req.deal_id,
            )
            for r in old_rows:
                payload = r["payload"] or {}
                if isinstance(payload, str):
                    payload = json.loads(payload)
                body = payload.get("body_text") or payload.get("summary") or ""
                if body:
                    event_texts.append(body[:300])
            budget_val, budget_ev = _budget_score(event_texts)

            # Trend: recent 7d vs prior 7d
            cutoff = now_ts - 7 * 86_400
            recent_cnt = sum(1 for r in activity_rows if r["created_at"] and r["created_at"].timestamp() >= cutoff)
            older_cnt  = sum(1 for r in activity_rows if r["created_at"] and r["created_at"].timestamp() < cutoff)
            if recent_cnt > older_cnt:
                trend, trend_delta = "up", recent_cnt - older_cnt
            elif recent_cnt < older_cnt:
                trend, trend_delta = "down", -(older_cnt - recent_cnt)

    except Exception as exc:
        log.error("reality_score.db_error", error=str(exc), deal_id=req.deal_id)

    # Factor 4: Close date proximity (from request body — no DB needed)
    proximity_val, proximity_ev = _proximity_score(req.close_date)

    factor_scores = {
        "recency":   recency_val,
        "breadth":   breadth_val,
        "sentiment": sentiment_val,
        "proximity": proximity_val,
        "budget":    budget_val,
    }
    total = _weighted_total(factor_scores)

    weak = [k for k, v in factor_scores.items() if v < 40]
    explanation = (
        f"Weak on {', '.join(weak)}. {recency_ev}."
        if weak else "Strong buying signals across all dimensions."
    )

    return RealityScoreResponse(
        deal_id=req.deal_id,
        score=total,
        trend=trend,
        trend_delta=trend_delta,
        explanation=explanation,
        factors=[
            ScoreFactor(name="Activity recency",     weight=WEIGHTS["recency"],   score=recency_val,   evidence=recency_ev),
            ScoreFactor(name="Engagement breadth",   weight=WEIGHTS["breadth"],   score=breadth_val,   evidence=breadth_ev),
            ScoreFactor(name="Sentiment trend",      weight=WEIGHTS["sentiment"], score=sentiment_val, evidence=sentiment_ev),
            ScoreFactor(name="Close date proximity", weight=WEIGHTS["proximity"], score=proximity_val, evidence=proximity_ev),
            ScoreFactor(name="Budget confirmed",     weight=WEIGHTS["budget"],    score=budget_val,    evidence=budget_ev),
        ],
        computed_at=datetime.now(timezone.utc).isoformat(),
    )


@router.post("/lead-score/{contact_id}")
async def calculate_lead_score(
    contact_id: str,
    tenant_id: str | None = None,
    x_tenant_id: str | None = Header(default=None),
):
    """Score a contact as a lead (0–100). Tiers: cold (<30), warm (30–69), hot (70+)."""
    # H-AI5: tenant comes from the gateway-set header (derived from the verified
    # JWT), never a client query param. A query tenant_id is allowed only if it
    # matches. (Matches every sibling endpoint; closes the missing guard.)
    header_tenant = (x_tenant_id or "").strip()
    if not header_tenant:
        raise HTTPException(status_code=403, detail="Tenant context missing")
    if tenant_id and tenant_id.strip() and tenant_id.strip() != header_tenant:
        raise HTTPException(status_code=403, detail="Tenant mismatch")
    tenant_id = header_tenant

    pool: asyncpg.Pool = await get_pool()
    cnt, last_at = 0, None
    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT COUNT(*) AS cnt, MAX(created_at) AS last_at
                FROM crm_events
                WHERE tenant_id = $1::uuid
                  AND entity_id = $2::uuid
                  AND created_at > NOW() - INTERVAL '90 days'
                """,
                tenant_id, contact_id,
            )
            if rows:
                cnt = rows[0]["cnt"] or 0
                last_at = rows[0]["last_at"]
    except Exception:
        pass

    activity_pts = min(50, int(cnt) * 5)
    recency_pts, recency_label = _recency_score(last_at)
    recency_contribution = round(recency_pts * 0.5)
    score = min(100, round(activity_pts + recency_contribution))
    tier = "hot" if score >= 70 else "warm" if score >= 30 else "cold"

    # Explainable factor breakdown (previously returned as []). This is a
    # transparent heuristic — recent engagement volume + recency — not an opaque
    # ML model; the contributions below always sum to the score.
    factors = [
        {
            "factor": "engagement_volume",
            "label": "Engagement volume",
            "points": activity_pts,
            "weight_pct": 50,
            "detail": f"{int(cnt)} activities in the last 90 days (5 pts each, capped at 50)",
        },
        {
            "factor": "recency",
            "label": "Recency of last touch",
            "points": recency_contribution,
            "weight_pct": 50,
            "detail": f"Last activity: {recency_label}",
        },
    ]
    return {
        "contact_id": contact_id,
        "score": score,
        "tier": tier,
        "method": "heuristic_v1",
        "factors": factors,
    }
