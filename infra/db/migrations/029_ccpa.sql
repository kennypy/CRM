-- 029: CCPA compliance columns on contacts table

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS do_not_sell      BOOLEAN DEFAULT FALSE;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS ccpa_opt_out_at  TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_contacts_do_not_sell
    ON contacts (tenant_id) WHERE do_not_sell = TRUE;
