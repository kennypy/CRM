"""
Anomaly detection — deterministic scan over the CRM event history.

Previously the anomalies feature had no backing logic at all: the gateway's
POST /scan proxied to an AI-engine route that did not exist (404), and the UI
fell back to a hardcoded DEMO_ALERTS array. This implements a real, explainable
detector (in the same deterministic spirit as the Reality Score engine) that
writes rows into the anomaly_alerts table the rest of the app already reads.

Detectors (v1, all derived from crm_events — no LLM, fully explainable):
  - stalled_deal:     an open deal with no activity for >= STALLED_DAYS.
  - ghost_deal:       an open deal that has never had a single activity event.
  - at_risk_account:  a company whose most recent engagement is >= DARK_DAYS old.

Each run is idempotent per entity+type: it will not create a second open alert
for something already flagged and open.
"""

import json
from fastapi import APIRouter, Query

from ..db import get_pool

router = APIRouter()

STALLED_DAYS = 14   # open deal, no activity for this long
GHOST_DAYS = 21     # open deal created this long ago with zero activity
DARK_DAYS = 30      # account with no engagement for this long

_OPEN_STAGE_EXCLUDE = "(payload->>'stage' ILIKE '%won%' OR payload->>'stage' ILIKE '%lost%')"


def _severity_for_days(days: float, warn: int, high: int, critical: int) -> str:
    if days >= critical:
        return "critical"
    if days >= high:
        return "high"
    if days >= warn:
        return "medium"
    return "low"


@router.post("/scan")
async def scan(tenant_id: str = Query(..., alias="tenantId")):
    """Run all detectors for a tenant and upsert open alerts. Returns a summary."""
    pool = await get_pool()
    created = 0

    async with pool.acquire() as conn:
        # ── Deal state: latest activity + whether the deal is still open ──────
        # A "deal" is any entity that has a deal.created event. Its latest stage
        # comes from the most recent deal.stage_changed; its last touch is the
        # most recent event of any kind on that entity.
        deals = await conn.fetch(
            """
            WITH deal_ids AS (
              SELECT DISTINCT entity_id, MIN(created_at) AS created_at
              FROM crm_events
              WHERE tenant_id = $1 AND event_type = 'deal.created'
              GROUP BY entity_id
            ),
            latest_stage AS (
              SELECT DISTINCT ON (entity_id) entity_id,
                     payload->>'stage' AS stage,
                     payload->>'name'  AS name,
                     (payload->>'value')::numeric AS value
              FROM crm_events
              WHERE tenant_id = $1 AND event_type = 'deal.stage_changed'
              ORDER BY entity_id, created_at DESC
            ),
            last_touch AS (
              SELECT entity_id, MAX(created_at) AS last_activity_at, COUNT(*) AS event_count
              FROM crm_events
              WHERE tenant_id = $1 AND entity_type = 'deal'
              GROUP BY entity_id
            )
            SELECT d.entity_id,
                   d.created_at,
                   ls.stage,
                   COALESCE(ls.name, 'Untitled deal') AS name,
                   ls.value,
                   lt.last_activity_at,
                   COALESCE(lt.event_count, 0) AS event_count,
                   EXTRACT(EPOCH FROM (NOW() - COALESCE(lt.last_activity_at, d.created_at))) / 86400.0 AS days_since_activity,
                   EXTRACT(EPOCH FROM (NOW() - d.created_at)) / 86400.0 AS age_days
            FROM deal_ids d
            LEFT JOIN latest_stage ls ON ls.entity_id = d.entity_id
            LEFT JOIN last_touch  lt ON lt.entity_id = d.entity_id
            WHERE ls.stage IS NULL
               OR NOT (ls.stage ILIKE '%won%' OR ls.stage ILIKE '%lost%')
            """,
            tenant_id,
        )

        for d in deals:
            days = float(d["days_since_activity"] or 0)
            has_activity = (d["last_activity_at"] is not None) and (d["event_count"] > 1)

            if not has_activity and float(d["age_days"] or 0) >= GHOST_DAYS:
                created += await _upsert_alert(
                    conn, tenant_id, "deal", d["entity_id"], "ghost_deal",
                    severity="high",
                    title=f"Ghost deal: {d['name']}",
                    description=(
                        f"This deal has had no logged activity in the {int(d['age_days'])} days "
                        f"since it was created. It may be stalled or was never worked."
                    ),
                    evidence=[
                        {"signal": "age_days", "value": round(float(d["age_days"]), 1)},
                        {"signal": "activity_events", "value": int(d["event_count"])},
                    ],
                )
            elif days >= STALLED_DAYS:
                created += await _upsert_alert(
                    conn, tenant_id, "deal", d["entity_id"], "stalled_deal",
                    severity=_severity_for_days(days, warn=STALLED_DAYS, high=30, critical=45),
                    title=f"Stalled deal: {d['name']}",
                    description=(
                        f"No activity on this deal for {int(days)} days "
                        f"(stage: {d['stage'] or 'unknown'}). Consider re-engaging."
                    ),
                    evidence=[
                        {"signal": "days_since_activity", "value": round(days, 1)},
                        {"signal": "stage", "value": d["stage"] or "unknown"},
                    ],
                )

        # ── At-risk accounts: companies gone dark ────────────────────────────
        accounts = await conn.fetch(
            """
            SELECT entity_id,
                   MAX(created_at) AS last_activity_at,
                   EXTRACT(EPOCH FROM (NOW() - MAX(created_at))) / 86400.0 AS days_dark
            FROM crm_events
            WHERE tenant_id = $1 AND entity_type = 'company'
            GROUP BY entity_id
            HAVING MAX(created_at) < NOW() - ($2 || ' days')::interval
            """,
            tenant_id, str(DARK_DAYS),
        )
        for a in accounts:
            days = float(a["days_dark"] or 0)
            created += await _upsert_alert(
                conn, tenant_id, "company", a["entity_id"], "at_risk_account",
                severity=_severity_for_days(days, warn=DARK_DAYS, high=60, critical=90),
                title="Account has gone dark",
                description=f"No engagement with this account for {int(days)} days.",
                evidence=[{"signal": "days_since_engagement", "value": round(days, 1)}],
            )

    return {"success": True, "data": {"alerts_created": created}}


async def _upsert_alert(
    conn, tenant_id: str, entity_type: str, entity_id: str, alert_type: str,
    severity: str, title: str, description: str, evidence: list,
) -> int:
    """Insert an open alert unless one of the same type is already open for this
    entity. Returns 1 if a new row was created, else 0."""
    exists = await conn.fetchval(
        """SELECT 1 FROM anomaly_alerts
           WHERE tenant_id = $1 AND entity_type = $2 AND entity_id = $3
             AND alert_type = $4 AND status = 'open'
           LIMIT 1""",
        tenant_id, entity_type, entity_id, alert_type,
    )
    if exists:
        return 0
    await conn.execute(
        """INSERT INTO anomaly_alerts
             (tenant_id, entity_type, entity_id, alert_type, severity, title, description, evidence)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)""",
        tenant_id, entity_type, entity_id, alert_type, severity, title, description,
        json.dumps(evidence),
    )
    return 1
