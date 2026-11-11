-- Migration 061: Lead-to-Quote parity.
--
-- Closes the gaps between NexCRM and an enterprise Lead-to-Quote process:
--   1. Lead conversion audit (lead → account + contact + opportunity)
--   2. Lead assignment rules (criteria → user or team round-robin)
--   3. Web-to-lead capture forms
--   4. Price books + entries (per-currency list prices)
--   5. Multi-step approval processes (quote discount approvals)
--   6. Declarative validation rules
--   7. Field history tracking (generic; drives stage-duration reporting)
--   8. Opportunity teams + splits
--
-- Graph entities (contacts, companies, deals) live in Apache AGE, so the
-- *_id columns referencing them are plain UUIDs without foreign keys — the
-- same convention as quotes.deal_id in migration 008.

-- ── 1. Lead conversions ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lead_conversions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id      UUID NOT NULL,
  company_id      UUID,
  company_created BOOLEAN NOT NULL DEFAULT false,
  deal_id         UUID,
  lead_source     TEXT,
  owner_id        UUID REFERENCES users(id) ON DELETE SET NULL,
  converted_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  lead_created_at TIMESTAMPTZ,
  converted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, contact_id)
);
CREATE INDEX IF NOT EXISTS idx_lead_conversions_tenant_time
  ON lead_conversions (tenant_id, converted_at DESC);

-- Every lead that enters the system is registered here so conversion rates
-- have a denominator that does not depend on querying the graph.
CREATE TABLE IF NOT EXISTS lead_registry (
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id  UUID NOT NULL,
  lead_source TEXT,
  owner_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, contact_id)
);
CREATE INDEX IF NOT EXISTS idx_lead_registry_tenant_time
  ON lead_registry (tenant_id, created_at DESC);

-- ── 2. Lead assignment rules ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lead_assignment_rules (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  priority         INTEGER NOT NULL DEFAULT 100,
  active           BOOLEAN NOT NULL DEFAULT true,
  conditions       JSONB NOT NULL DEFAULT '[]'::jsonb,
  assign_to_type   TEXT NOT NULL CHECK (assign_to_type IN ('user', 'team_round_robin')),
  assign_to_id     UUID NOT NULL,
  rr_last_user_id  UUID,
  created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lead_assignment_rules_tenant
  ON lead_assignment_rules (tenant_id, priority) WHERE active = true;

-- ── 3. Web-to-lead forms ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS web_to_lead_forms (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  form_key         TEXT NOT NULL UNIQUE,
  allowed_origins  TEXT[] NOT NULL DEFAULT '{}',
  default_source   TEXT NOT NULL DEFAULT 'web',
  active           BOOLEAN NOT NULL DEFAULT true,
  submissions      INTEGER NOT NULL DEFAULT 0,
  created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_web_to_lead_forms_tenant ON web_to_lead_forms (tenant_id);

-- ── 4. Price books ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS price_books (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT,
  currency     TEXT NOT NULL DEFAULT 'USD',
  is_standard  BOOLEAN NOT NULL DEFAULT false,
  active       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, name)
);
-- At most one standard price book per tenant.
CREATE UNIQUE INDEX IF NOT EXISTS uq_price_books_standard
  ON price_books (tenant_id) WHERE is_standard = true;

CREATE TABLE IF NOT EXISTS price_book_entries (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  price_book_id  UUID NOT NULL REFERENCES price_books(id) ON DELETE CASCADE,
  product_id     UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  unit_price     NUMERIC(14,2) NOT NULL CHECK (unit_price >= 0),
  active         BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (price_book_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_price_book_entries_book ON price_book_entries (price_book_id);

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS price_book_id  UUID REFERENCES price_books(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS synced_to_deal BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS synced_at      TIMESTAMPTZ;
-- List price captured per line so discounts are measured against list, not
-- against whatever unit price was typed in.
ALTER TABLE quote_items ADD COLUMN IF NOT EXISTS list_price NUMERIC(14,2);
-- Discount level the current approval covered (re-approval only if exceeded).
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS approved_discount_pct NUMERIC(6,2);

-- Gap-free per-tenant quote numbers (previously Q-<year>-<random 4 digits>,
-- which collides after a few hundred quotes and had no uniqueness guarantee).
CREATE TABLE IF NOT EXISTS quote_counters (
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  year        INTEGER NOT NULL,
  last_value  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, year)
);
-- Seed counters past any existing numbers so new ones never collide.
INSERT INTO quote_counters (tenant_id, year, last_value)
SELECT tenant_id, split_part(quote_number, '-', 2)::int, MAX(split_part(quote_number, '-', 3)::int)
  FROM quotes
 WHERE quote_number ~ '^Q-[0-9]{4}-[0-9]+$'
 GROUP BY tenant_id, split_part(quote_number, '-', 2)
ON CONFLICT (tenant_id, year) DO UPDATE SET last_value = GREATEST(quote_counters.last_value, EXCLUDED.last_value);

-- One synced quote per opportunity.
CREATE UNIQUE INDEX IF NOT EXISTS uq_quotes_synced_per_deal
  ON quotes (tenant_id, deal_id) WHERE synced_to_deal = true AND deal_id IS NOT NULL;

-- ── 5. Approvals ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS approval_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type   TEXT NOT NULL CHECK (entity_type IN ('quote')),
  entity_id     UUID NOT NULL,
  entity_label  TEXT,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'approved', 'rejected', 'recalled')),
  reason        TEXT,
  submitted_by  UUID NOT NULL REFERENCES users(id),
  submit_comment TEXT,
  submitted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ,
  current_step  INTEGER NOT NULL DEFAULT 1,
  snapshot      JSONB NOT NULL DEFAULT '{}'::jsonb
);
-- One open request per record.
CREATE UNIQUE INDEX IF NOT EXISTS uq_approval_requests_open
  ON approval_requests (tenant_id, entity_type, entity_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_approval_requests_tenant
  ON approval_requests (tenant_id, status, submitted_at DESC);

CREATE TABLE IF NOT EXISTS approval_steps (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  request_id   UUID NOT NULL REFERENCES approval_requests(id) ON DELETE CASCADE,
  step_number  INTEGER NOT NULL,
  approver_id  UUID NOT NULL REFERENCES users(id),
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'approved', 'rejected', 'skipped')),
  comment      TEXT,
  acted_at     TIMESTAMPTZ,
  UNIQUE (request_id, step_number)
);
CREATE INDEX IF NOT EXISTS idx_approval_steps_approver
  ON approval_steps (tenant_id, approver_id, status);

-- ── 6. Validation rules ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS validation_rules (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type    TEXT NOT NULL CHECK (entity_type IN ('contact', 'company', 'deal', 'quote')),
  name           TEXT NOT NULL,
  active         BOOLEAN NOT NULL DEFAULT true,
  condition      JSONB NOT NULL,
  error_message  TEXT NOT NULL,
  error_field    TEXT,
  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, entity_type, name)
);
CREATE INDEX IF NOT EXISTS idx_validation_rules_tenant_entity
  ON validation_rules (tenant_id, entity_type) WHERE active = true;

-- ── 7. Field history ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS field_history (
  id           BIGSERIAL PRIMARY KEY,
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type  TEXT NOT NULL,
  entity_id    UUID NOT NULL,
  field        TEXT NOT NULL,
  old_value    JSONB,
  new_value    JSONB,
  changed_by   UUID,
  changed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_field_history_entity
  ON field_history (tenant_id, entity_type, entity_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_field_history_field_time
  ON field_history (tenant_id, entity_type, field, changed_at);

-- ── 8. Opportunity teams + splits ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS deal_team_members (
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  deal_id     UUID NOT NULL,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'other'
              CHECK (role IN ('owner', 'sales_engineer', 'executive_sponsor', 'overlay', 'other')),
  access      TEXT NOT NULL DEFAULT 'read' CHECK (access IN ('read', 'write')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (deal_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_deal_team_members_user ON deal_team_members (tenant_id, user_id);

CREATE TABLE IF NOT EXISTS deal_splits (
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  deal_id     UUID NOT NULL,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  split_type  TEXT NOT NULL CHECK (split_type IN ('revenue', 'overlay')),
  percent     NUMERIC(5,2) NOT NULL CHECK (percent > 0 AND percent <= 100),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (deal_id, user_id, split_type)
);
CREATE INDEX IF NOT EXISTS idx_deal_splits_user ON deal_splits (tenant_id, user_id);

-- ── 9. In-app notifications ──────────────────────────────────────────────────
-- /api/v1/notifications queried these tables but no migration ever created
-- them; the route fell back to hard-coded demo notifications for real users.
CREATE TABLE IF NOT EXISTS notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT,
  priority    TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
  action_url  TEXT,
  entity_type TEXT,
  entity_id   UUID,
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user
  ON notifications (tenant_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON notifications (tenant_id, user_id) WHERE read_at IS NULL;

CREATE TABLE IF NOT EXISTS notification_preferences (
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  settings    JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, user_id)
);

-- Manager-chain lookups (role hierarchy) are recursive on users.manager_id.
CREATE INDEX IF NOT EXISTS idx_users_tenant_manager ON users (tenant_id, manager_id);

-- ── RLS: same idempotent loop as 059, for the tables added above ─────────────
DO $$
DECLARE t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexcrm_app') THEN
    RAISE NOTICE 'nexcrm_app role missing (042 not applied?) — skipping RLS';
    RETURN;
  END IF;
  FOREACH t IN ARRAY ARRAY[
    'lead_conversions', 'lead_registry', 'lead_assignment_rules', 'web_to_lead_forms',
    'price_books', 'price_book_entries', 'approval_requests', 'approval_steps',
    'validation_rules', 'field_history', 'deal_team_members', 'deal_splits',
    'notifications', 'notification_preferences', 'quote_counters'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I FOR ALL TO nexcrm_app '
      || 'USING (tenant_id::text = current_setting(''app.current_tenant'', true)) '
      || 'WITH CHECK (tenant_id::text = current_setting(''app.current_tenant'', true))',
      t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO nexcrm_app', t);
  END LOOP;
  GRANT USAGE, SELECT ON SEQUENCE field_history_id_seq TO nexcrm_app;
END $$;
