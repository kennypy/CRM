"""
Reality Score + Lead Scoring Router
"""

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()


class RealityScoreRequest(BaseModel):
    deal_id: str
    tenant_id: str


@router.post("/reality-score")
async def calculate_reality_score(request: RealityScoreRequest):
    """
    Calculate Reality Score for a deal.

    Factors (configurable weights per tenant):
      - Recency of activity (0.30): days since last email/call/meeting
      - Engagement breadth (0.25): % of buying group members active in last 14d
      - Sentiment trend (0.20): rolling sentiment from last 5 activities
      - Close date proximity (0.15): time remaining vs. typical sales cycle
      - Budget confirmation (0.10): was budget explicitly mentioned?

    TODO: Query graph-core for deal signals, run scoring model.
    """
    # Placeholder — real implementation queries graph-core
    return {
        "deal_id": request.deal_id,
        "score": 72,
        "trend": "down",
        "trend_delta": -8,
        "explanation": "No activity in 6 days. Legal objection in last meeting. Budget confirmed.",
        "factors": [
            {"name": "Activity recency", "weight": 0.30, "score": 40, "evidence": "Last contact 6 days ago"},
            {"name": "Engagement breadth", "weight": 0.25, "score": 80, "evidence": "4/5 stakeholders active"},
            {"name": "Sentiment trend", "weight": 0.20, "score": 60, "evidence": "Legal concern detected"},
            {"name": "Close date proximity", "weight": 0.15, "score": 90, "evidence": "12 days remaining"},
            {"name": "Budget confirmed", "weight": 0.10, "score": 100, "evidence": "Confirmed in email 2w ago"},
        ],
    }


@router.post("/lead-score/{contact_id}")
async def calculate_lead_score(contact_id: str, tenant_id: str):
    """
    Score a contact as a lead (0–100).
    TODO: implement signal aggregation from graph.
    """
    return {
        "contact_id": contact_id,
        "score": 68,
        "tier": "warm",
        "factors": [],
    }
