-- Migration 063: reliable event consumption + delayed workflow actions.
--
-- The workflow engine consumed crm_events with a `created_at > cursor LIMIT
-- 100` cursor, which silently skipped (a) events sharing a timestamp across a
-- batch boundary and (b) events from transactions that committed after the
-- cursor had moved past their timestamp. Workflows and outbound webhooks for
-- those events never fired. Events now carry processed_at; the engine takes
-- every unprocessed row whenever it becomes visible.

ALTER TABLE crm_events ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;

-- Everything at or before the legacy cursor was already handled — mark it so
-- deploying this does not replay history into workflows/webhooks.
UPDATE crm_events e
   SET processed_at = COALESCE(s.last_processed_at, NOW())
  FROM (SELECT MAX(last_processed_at) AS last_processed_at FROM workflow_engine_state) s
 WHERE e.processed_at IS NULL
   AND (s.last_processed_at IS NULL OR e.created_at <= s.last_processed_at);

CREATE INDEX IF NOT EXISTS idx_crm_events_unprocessed
  ON crm_events (created_at) WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_crm_events_entity
  ON crm_events (tenant_id, entity_id, created_at DESC);

-- Delayed workflow actions ("send follow-up 3 days after stage change").
CREATE TABLE IF NOT EXISTS workflow_delayed_actions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workflow_id  UUID NOT NULL REFERENCES workflow_definitions(id) ON DELETE CASCADE,
  run_id       UUID,
  action       JSONB NOT NULL,
  event        JSONB NOT NULL,
  run_at       TIMESTAMPTZ NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'failed', 'skipped')),
  result       TEXT,
  attempts     INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  executed_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_workflow_delayed_due
  ON workflow_delayed_actions (run_at) WHERE status = 'pending';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexcrm_app') THEN
    ALTER TABLE public.workflow_delayed_actions ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_isolation ON public.workflow_delayed_actions;
    CREATE POLICY tenant_isolation ON public.workflow_delayed_actions FOR ALL TO nexcrm_app
      USING (tenant_id::text = current_setting('app.current_tenant', true))
      WITH CHECK (tenant_id::text = current_setting('app.current_tenant', true));
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.workflow_delayed_actions TO nexcrm_app;
  END IF;
END $$;

-- The webhook delivery worker updates updated_at on every state change, but
-- the column never existed — every delivery errored and none were sent.
ALTER TABLE outbound_webhook_deliveries ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
