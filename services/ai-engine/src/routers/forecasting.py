"""
Pipeline forecasting router — generates AI-powered forecast narratives
by analyzing deal velocity, stage conversion rates, and historical win rates.
"""

import os
import json
import httpx
import structlog
from fastapi import APIRouter, Query

from ..db import get_pool

log = structlog.get_logger()
router = APIRouter()

GRAPH_CORE_URL = os.getenv("GRAPH_CORE_URL", "http://localhost:4002")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")


@router.get("/forecast")
async def get_forecast(
    tenant_id: str = Query(..., alias="tenantId"),
    period: str = Query("quarter", regex="^(month|quarter|year)$"),
):
    """Generate pipeline forecast with AI narrative."""
    pool = await get_pool()

    # Gather pipeline data from crm_events and deals
    async with pool.acquire() as conn:
        # Deal stage metrics
        stage_counts = await conn.fetch(
            """SELECT payload->>'stage' AS stage,
                      COUNT(*) AS count,
                      SUM((payload->>'value')::numeric) AS total_value
               FROM crm_events
               WHERE tenant_id = $1
                 AND event_type = 'deal.stage_changed'
                 AND created_at > NOW() - INTERVAL '90 days'
               GROUP BY payload->>'stage'""",
            tenant_id,
        )

        # Win rate
        wins = await conn.fetchval(
            """SELECT COUNT(*) FROM crm_events
               WHERE tenant_id = $1 AND event_type = 'deal.stage_changed'
                 AND payload->>'stage' ILIKE '%won%'
                 AND created_at > NOW() - INTERVAL '90 days'""",
            tenant_id,
        ) or 0

        total_closed = await conn.fetchval(
            """SELECT COUNT(*) FROM crm_events
               WHERE tenant_id = $1 AND event_type = 'deal.stage_changed'
                 AND (payload->>'stage' ILIKE '%won%' OR payload->>'stage' ILIKE '%lost%')
                 AND created_at > NOW() - INTERVAL '90 days'""",
            tenant_id,
        ) or 1

        # Average deal velocity (days from creation to close)
        avg_velocity = await conn.fetchval(
            """SELECT AVG(EXTRACT(EPOCH FROM (e2.created_at - e1.created_at)) / 86400)
               FROM crm_events e1
               JOIN crm_events e2 ON e1.entity_id = e2.entity_id AND e1.tenant_id = e2.tenant_id
               WHERE e1.tenant_id = $1
                 AND e1.event_type = 'deal.created'
                 AND e2.event_type = 'deal.stage_changed'
                 AND (e2.payload->>'stage' ILIKE '%won%' OR e2.payload->>'stage' ILIKE '%lost%')
                 AND e2.created_at > NOW() - INTERVAL '90 days'""",
            tenant_id,
        )

        # Recent revenue
        recent_revenue = await conn.fetchval(
            """SELECT COALESCE(SUM((payload->>'value')::numeric), 0)
               FROM crm_events
               WHERE tenant_id = $1 AND event_type = 'deal.stage_changed'
                 AND payload->>'stage' ILIKE '%won%'
                 AND created_at > NOW() - INTERVAL '30 days'""",
            tenant_id,
        ) or 0

    win_rate = round((wins / max(total_closed, 1)) * 100, 1)
    velocity_days = round(float(avg_velocity or 30), 1)

    pipeline_data = {
        "stages": [
            {"stage": str(s["stage"]), "count": s["count"], "value": float(s["total_value"] or 0)}
            for s in stage_counts
        ],
        "winRate": win_rate,
        "avgVelocityDays": velocity_days,
        "recentRevenue30d": float(recent_revenue),
        "period": period,
    }

    # Generate AI narrative
    narrative = await _generate_forecast_narrative(pipeline_data)

    # Save snapshot
    async with pool.acquire() as conn:
        snapshot = await conn.fetchrow(
            """INSERT INTO ai_forecast_snapshots (tenant_id, period, pipeline_data, forecast_data)
               VALUES ($1, $2, $3, $4)
               RETURNING id, created_at""",
            tenant_id, period, json.dumps(pipeline_data), json.dumps({"narrative": narrative}),
        )

    return {
        "success": True,
        "data": {
            "id": str(snapshot["id"]),
            "period": period,
            "pipeline": pipeline_data,
            "narrative": narrative,
            "createdAt": snapshot["created_at"].isoformat(),
        },
    }


async def _generate_forecast_narrative(data: dict) -> str:
    """Use Claude to generate a natural-language forecast narrative."""
    if not ANTHROPIC_API_KEY:
        return _fallback_narrative(data)

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
                    "max_tokens": 600,
                    "messages": [{
                        "role": "user",
                        "content": f"""You are a sales analytics expert. Given this pipeline data, write a
                        concise 3-4 sentence forecast narrative for a sales manager. Be specific with numbers.
                        Include: current pipeline health, projected close rate, key risks, and one recommendation.

                        Pipeline data:
                        - Stages: {json.dumps(data.get('stages', []))}
                        - Win rate (90d): {data.get('winRate', 0)}%
                        - Average deal velocity: {data.get('avgVelocityDays', 0)} days
                        - Revenue last 30 days: ${data.get('recentRevenue30d', 0):,.0f}
                        - Period: {data.get('period', 'quarter')}

                        Write in a direct, professional tone. No headers or bullet points.""",
                    }],
                },
            )
            if resp.status_code == 200:
                result = resp.json()
                return result.get("content", [{}])[0].get("text", _fallback_narrative(data))
    except Exception as e:
        log.warning("forecast.ai_error", error=str(e))

    return _fallback_narrative(data)


def _fallback_narrative(data: dict) -> str:
    """Generate a basic narrative without AI."""
    total_pipeline = sum(s.get("value", 0) for s in data.get("stages", []))
    win_rate = data.get("winRate", 0)
    velocity = data.get("avgVelocityDays", 30)
    revenue = data.get("recentRevenue30d", 0)

    projected = total_pipeline * (win_rate / 100)

    return (
        f"Current pipeline stands at ${total_pipeline:,.0f} across {len(data.get('stages', []))} stages. "
        f"With a {win_rate}% win rate and {velocity:.0f}-day average velocity, "
        f"projected revenue for the period is approximately ${projected:,.0f}. "
        f"Last 30 days closed ${revenue:,.0f}."
    )
