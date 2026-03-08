-- 028: GDPR Data Subject Request table and automation columns
-- Ensures the table exists and adds columns for worker-driven DSR processing.

CREATE TABLE IF NOT EXISTS data_subject_requests (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    type            TEXT NOT NULL CHECK (type IN (
        'access', 'erasure', 'portability', 'rectification', 'restriction',
        'do_not_sell', 'ccpa_access', 'ccpa_delete'
    )),
    subject_email   TEXT NOT NULL,
    subject_name    TEXT,
    notes           TEXT,
    status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending', 'in_progress', 'completed', 'denied', 'failed'
    )),
    resolution      TEXT,
    download_url    TEXT,
    completed_at    TIMESTAMPTZ,
    error_message   TEXT,
    processed_by_worker BOOLEAN DEFAULT FALSE,
    created_by      UUID REFERENCES users(id),
    resolved_by     UUID REFERENCES users(id),
    resolved_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dsr_tenant_status
    ON data_subject_requests (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_dsr_subject_email
    ON data_subject_requests (tenant_id, subject_email);
