-- NexCRM Migration 004 — Stripe Billing Columns
-- Adds Stripe customer/subscription tracking to the tenants table.
-- subscription_period_end is the current billing cycle end (unix → timestamptz).

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS stripe_customer_id         TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id     TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS stripe_subscription_status TEXT
    CHECK (stripe_subscription_status IN (
      'active', 'past_due', 'canceled', 'unpaid',
      'trialing', 'paused', 'incomplete', 'incomplete_expired'
    )),
  ADD COLUMN IF NOT EXISTS subscription_period_end    TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_tenants_stripe_customer
  ON tenants(stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;
