-- ── Migration 008: Quotes, Products, Manager→Rep Hierarchy ───────────────────
-- Adds:
--   1. manager_id on users (rep hierarchy)
--   2. can_quote on users (per-user quoting permission)
--   3. quoting settings on tenants (discount approval threshold, etc.)
--   4. products table (product catalog)
--   5. quotes table (quote lifecycle)
--   6. quote_items table (line items)
--
-- NOTE: companies, contacts, and deals are stored as Apache AGE graph nodes —
-- there are no relational tables for those entities. FK references to them are
-- omitted; the columns (deal_id, company_id, contact_id) are plain UUIDs that
-- reference graph node IDs by convention.

-- ── 1. Manager hierarchy on users ────────────────────────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS manager_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS can_quote  BOOLEAN NOT NULL DEFAULT false;

-- Admins and managers get quoting enabled by default
UPDATE users SET can_quote = true WHERE role IN ('admin', 'manager');

CREATE INDEX IF NOT EXISTS idx_users_manager ON users(manager_id) WHERE manager_id IS NOT NULL;

-- ── 2. Tenant quoting settings ───────────────────────────────────────────────
-- discount_approval_threshold: discounts ABOVE this % require manager approval
-- (0 = all discounts need approval, 100 = none do, default = 10)
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS discount_approval_threshold NUMERIC(5,2) NOT NULL DEFAULT 10.00,
  ADD COLUMN IF NOT EXISTS quote_valid_days            INTEGER       NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS quote_send_method           TEXT          NOT NULL DEFAULT 'email'
    CHECK (quote_send_method IN ('email', 'link', 'both'));

-- ── 3. Product catalog ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sku           TEXT,
  name          TEXT        NOT NULL,
  description   TEXT,
  unit_price    NUMERIC(14,2) NOT NULL DEFAULT 0,
  currency      TEXT        NOT NULL DEFAULT 'USD',
  billing_cycle TEXT        NOT NULL DEFAULT 'one_time'
    CHECK (billing_cycle IN ('one_time', 'monthly', 'annual')),
  active        BOOLEAN     NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_tenant ON products(tenant_id) WHERE active = true;

-- ── 4. Quotes ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS quotes (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  quote_number    TEXT        NOT NULL,   -- e.g. Q-2026-0001
  -- deal_id / contact_id / company_id reference AGE graph node IDs (no FK)
  deal_id         UUID,
  contact_id      UUID,
  company_id      UUID,
  created_by      UUID        NOT NULL REFERENCES users(id),
  assigned_to     UUID        REFERENCES users(id) ON DELETE SET NULL,
  status          TEXT        NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','pending_approval','sent','viewed','accepted','rejected','expired')),
  approval_required BOOLEAN   NOT NULL DEFAULT false,
  approved_by     UUID        REFERENCES users(id) ON DELETE SET NULL,
  approved_at     TIMESTAMPTZ,
  -- financials
  subtotal        NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount_type   TEXT        NOT NULL DEFAULT 'none'
    CHECK (discount_type IN ('none','percent','fixed')),
  discount_value  NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_rate        NUMERIC(5,2) NOT NULL DEFAULT 0,
  total           NUMERIC(14,2) NOT NULL DEFAULT 0,
  currency        TEXT        NOT NULL DEFAULT 'USD',
  -- meta
  title           TEXT        NOT NULL,
  notes           TEXT,
  terms           TEXT,
  valid_until     DATE,
  sent_at         TIMESTAMPTZ,
  viewed_at       TIMESTAMPTZ,
  accepted_at     TIMESTAMPTZ,
  rejected_at     TIMESTAMPTZ,
  pdf_key         TEXT,       -- future: S3 key for stored PDF
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quotes_tenant    ON quotes(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quotes_deal      ON quotes(deal_id)    WHERE deal_id    IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_quotes_company   ON quotes(company_id) WHERE company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_quotes_contact   ON quotes(contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_quotes_status    ON quotes(tenant_id, status);

-- ── 5. Quote items (line items) ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS quote_items (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id      UUID        NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  product_id    UUID        REFERENCES products(id) ON DELETE SET NULL,
  -- snapshot of product at quote time (survives product changes/deletions)
  product_name  TEXT        NOT NULL,
  description   TEXT,
  quantity      NUMERIC(10,3) NOT NULL DEFAULT 1,
  unit_price    NUMERIC(14,2) NOT NULL,
  discount_pct  NUMERIC(5,2) NOT NULL DEFAULT 0,  -- per-line discount %
  line_total    NUMERIC(14,2) NOT NULL,            -- qty * unit_price * (1 - discount_pct/100)
  sort_order    INTEGER     NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quote_items_quote ON quote_items(quote_id);

-- ── 6. Quote number sequence per tenant ──────────────────────────────────────
-- A simple function to generate Q-YYYY-NNNN style numbers
CREATE OR REPLACE FUNCTION next_quote_number(p_tenant_id UUID)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  v_count INTEGER;
  v_year  TEXT := to_char(NOW(), 'YYYY');
BEGIN
  SELECT COUNT(*) + 1 INTO v_count
  FROM quotes
  WHERE tenant_id = p_tenant_id
    AND to_char(created_at, 'YYYY') = v_year;
  RETURN 'Q-' || v_year || '-' || lpad(v_count::TEXT, 4, '0');
END;
$$;
