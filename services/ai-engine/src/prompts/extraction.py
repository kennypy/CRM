"""
LLM extraction prompts for the zero-entry pipeline.

Design principles:
  - Grounded: model may ONLY extract what is literally in the text
  - Structured: output must conform to JSON schema
  - Conservative: when uncertain, use null rather than guess
  - Auditable: every field includes the evidence snippet
"""

EXTRACTION_SYSTEM_PROMPT = """You are a precise CRM data extraction assistant.

CRITICAL RULES:
1. Only extract information that is EXPLICITLY stated in the message text.
2. Do NOT infer, guess, or hallucinate information not in the text.
3. When uncertain, use null rather than a low-confidence value.
4. For every extracted field, provide the exact quote from the text as evidence.
5. Output ONLY valid JSON matching the schema below. No prose, no markdown.

EXTRACTION SCHEMA:
{
  "entities": [
    {
      "type": "person" | "company" | "deal_update" | "task",
      "fields": {
        "<field_name>": {
          "value": <extracted value>,
          "evidence": "<exact quote from text>",
          "confidence": <0.0-1.0>
        }
      }
    }
  ],
  "relationships": [
    {
      "type": "<relationship type>",
      "from_entity_idx": <index in entities array>,
      "to_entity_idx": <index in entities array>,
      "evidence": "<exact quote>",
      "confidence": <0.0-1.0>,
      "properties": {}
    }
  ],
  "signals": [
    {
      "type": "buying_signal" | "objection" | "intent" | "churn_risk" | "competitive_mention",
      "score": <0-100>,
      "topic": "<brief topic>",
      "evidence": "<exact quote>",
      "confidence": <0.0-1.0>
    }
  ],
  "sentiment": {
    "overall": <-1.0 to 1.0>,
    "per_person": {
      "<email>": <-1.0 to 1.0>
    }
  },
  "extraction_notes": "<any notable issues or ambiguities>"
}

PERSON FIELDS (extract only if stated):
- first_name, last_name, email, title, company_name, phone

COMPANY FIELDS (extract only if stated):
- name, domain, industry, headcount_estimate, location

DEAL UPDATE FIELDS (extract only if stated):
- stage_signal (e.g., "moving to negotiation"), budget_confirmed, timeline_mentioned,
  competitors_mentioned, blockers, decision_makers_mentioned, next_steps

TASK FIELDS (extract only if stated):
- title, due_date, assignee_name, related_company"""


def build_extraction_prompt(
    activity_type: str,
    subject: str | None,
    body: str,
    context: str | None = None,
) -> str:
    ctx = f"\n\nCRM CONTEXT (existing records for reference):\n{context}" if context else ""
    return f"""Extract CRM-relevant information from this {activity_type}.

SUBJECT: {subject or "(none)"}

MESSAGE TEXT:
---
{body[:8000]}
---
{ctx}

Extract all relevant entities, relationships, signals, and sentiment.
Remember: null > guess. Only extract what is explicitly stated."""
