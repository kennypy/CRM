-- NexCRM Migration 003 — Reality Score infrastructure
-- Adds two tables to support the deterministic TypeScript scoring engine.
-- AGE graph stores Activity nodes + RELATED_TO edges (schema-less, no migration needed).
-- Deal node gets archetype/declared_probability/is_expansion as graph properties.

-- ── Commercial intent signals per deal ────────────────────────────────────────
-- Written by the seed and (later) by the ingestion pipeline when a signal is detected.
-- Scoring engine reads this instead of scanning crm_events so queries stay O(1).
-- Fix 5: deal_uuid UUID (not TEXT) — stable application UUID, never AGE internal id.
CREATE TABLE IF NOT EXISTS deal_signals (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL,
  deal_uuid   UUID        NOT NULL,   -- matches Deal node's `id` property (our UUID)
  signal_type TEXT        NOT NULL
              CHECK (signal_type IN (
                'pricing_mentioned', 'quote_requested', 'quote_sent',
                'quote_opened',      'contract_sent',   'contract_opened'
              )),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source      TEXT        NOT NULL DEFAULT 'user',
  metadata    JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deal_signals_lookup
  ON deal_signals (tenant_id, deal_uuid, occurred_at DESC);

-- ── Score snapshots for 7-day trend delta ─────────────────────────────────────
-- Fix 6: written on EVERY score computation (not a periodic job).
-- Trend query: SELECT score WHERE computed_at < now() - '7 days' ORDER BY computed_at DESC LIMIT 1
CREATE TABLE IF NOT EXISTS deal_score_snapshots (
  id            UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID     NOT NULL,
  deal_uuid     UUID     NOT NULL,
  score         SMALLINT NOT NULL CHECK (score BETWEEN 0 AND 100),
  pillar_scores JSONB    NOT NULL,  -- {momentum, commercial, buying_group, structural}
  archetype     TEXT     NOT NULL DEFAULT 'simple',
  computed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deal_score_snapshots_lookup
  ON deal_score_snapshots (tenant_id, deal_uuid, computed_at DESC);
