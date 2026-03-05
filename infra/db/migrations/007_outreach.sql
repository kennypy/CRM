-- Migration 007: Outreach — Email, Phone, Sequences
--
-- Adds full sales engagement infrastructure:
--   1. email_threads / email_messages — per-rep compose, send, and inbox view
--   2. sequences / sequence_steps / sequence_enrollments / sequence_step_executions
--       — multi-channel sequence engine (Outreach-parity)
--   3. phone_calls — call log for native Twilio and iframe dialers
--   4. dialer_configs — per-tenant dialer configuration (encrypted credentials)
--   5. opt_out_records — CAN-SPAM / GDPR opt-out enforcement
--   6. outreach_usage — monthly counters for plan-limit enforcement
--
-- Security:
--   - All encrypted credential columns store AES-256-GCM ciphertext only.
--   - tenant_id is on every table for complete row-level isolation.
--   - Partial indexes exclude soft-deleted rows.

-- ── Email Threads ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS email_threads (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id      UUID,                                   -- nullable: thread may precede contact record
  deal_id         UUID,
  subject         TEXT        NOT NULL DEFAULT '(no subject)',
  snippet         TEXT,                                   -- last message preview
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  message_count   INTEGER     NOT NULL DEFAULT 0 CHECK (message_count >= 0),
  unread_count    INTEGER     NOT NULL DEFAULT 0 CHECK (unread_count >= 0),
  participants    JSONB       NOT NULL DEFAULT '[]',      -- [{email, name}]
  status          TEXT        NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open', 'archived', 'spam')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

CREATE INDEX idx_email_threads_tenant
  ON email_threads (tenant_id, last_message_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_email_threads_contact
  ON email_threads (tenant_id, contact_id, last_message_at DESC)
  WHERE contact_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX idx_email_threads_deal
  ON email_threads (tenant_id, deal_id, last_message_at DESC)
  WHERE deal_id IS NOT NULL AND deleted_at IS NULL;

-- ── Email Messages ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS email_messages (
  id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  thread_id                   UUID        NOT NULL REFERENCES email_threads(id) ON DELETE CASCADE,
  user_id                     UUID        REFERENCES users(id),      -- sending user (NULL for inbound)
  direction                   TEXT        NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  from_email                  TEXT        NOT NULL,
  from_name                   TEXT,
  to_recipients               JSONB       NOT NULL DEFAULT '[]',     -- [{email, name}]
  cc_recipients               JSONB       NOT NULL DEFAULT '[]',
  bcc_recipients              JSONB       NOT NULL DEFAULT '[]',
  subject                     TEXT        NOT NULL DEFAULT '(no subject)',
  body_text                   TEXT        NOT NULL DEFAULT '',
  provider                    TEXT        NOT NULL CHECK (provider IN ('gmail', 'outlook')),
  provider_message_id         TEXT,                                  -- Gmail messageId / EWS ItemId
  in_reply_to                 TEXT,                                  -- RFC-2822 In-Reply-To header value
  send_status                 TEXT        NOT NULL DEFAULT 'draft'
                              CHECK (send_status IN ('draft','scheduled','sending','sent','failed','bounced')),
  scheduled_at                TIMESTAMPTZ,
  sent_at                     TIMESTAMPTZ,
  error_message               TEXT,
  sequence_step_execution_id  UUID,                                  -- FK set after sequence tables created
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at                  TIMESTAMPTZ
);

CREATE INDEX idx_email_messages_thread
  ON email_messages (thread_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_email_messages_tenant_user
  ON email_messages (tenant_id, user_id, sent_at DESC)
  WHERE deleted_at IS NULL AND direction = 'outbound';

-- Dedup index: one row per provider message per tenant
CREATE UNIQUE INDEX idx_email_messages_provider_dedup
  ON email_messages (tenant_id, provider, provider_message_id)
  WHERE provider_message_id IS NOT NULL AND deleted_at IS NULL;

-- ── Sequences ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sequences (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                    TEXT        NOT NULL,
  description             TEXT,
  owner_id                UUID        REFERENCES users(id),
  status                  TEXT        NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft', 'active', 'paused', 'archived')),
  goal                    TEXT,
  -- Cached counters (updated by sequence runner)
  active_enrollments      INTEGER     NOT NULL DEFAULT 0 CHECK (active_enrollments >= 0),
  completed_enrollments   INTEGER     NOT NULL DEFAULT 0 CHECK (completed_enrollments >= 0),
  -- Settings: { timezone_mode: 'contact'|'rep'|'fixed', fixed_tz: string, send_days: int[], send_start: time, send_end: time }
  settings                JSONB       NOT NULL DEFAULT '{}',
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at              TIMESTAMPTZ
);

CREATE INDEX idx_sequences_tenant
  ON sequences (tenant_id, status, created_at DESC)
  WHERE deleted_at IS NULL;

-- ── Sequence Steps ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sequence_steps (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sequence_id     UUID        NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
  step_number     INTEGER     NOT NULL CHECK (step_number >= 1),
  type            TEXT        NOT NULL CHECK (type IN ('email', 'call', 'linkedin_task')),
  -- Offset from enrollment date (step 1) or previous step completion
  day_offset      INTEGER     NOT NULL DEFAULT 0 CHECK (day_offset >= 0),
  time_of_day     TIME        NOT NULL DEFAULT '09:00',
  -- Email step fields (populated when type = 'email')
  subject_template    TEXT,
  body_template       TEXT,                               -- supports {{first_name}}, {{last_name}}, {{company}}, {{title}}
  -- Call / task step fields
  task_note           TEXT,
  ai_suggestions      BOOLEAN NOT NULL DEFAULT true,    -- whether AI generates suggestions for this step
  settings            JSONB   NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (sequence_id, step_number)
);

CREATE INDEX idx_sequence_steps_sequence
  ON sequence_steps (sequence_id, step_number);

-- ── Sequence Enrollments ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sequence_enrollments (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sequence_id         UUID        NOT NULL REFERENCES sequences(id),
  -- Denormalized contact snapshot (no FK coupling, preserves history after merge/delete)
  contact_id          UUID,
  contact_email       TEXT        NOT NULL,
  contact_first_name  TEXT        NOT NULL DEFAULT '',
  contact_last_name   TEXT        NOT NULL DEFAULT '',
  contact_timezone    TEXT        NOT NULL DEFAULT 'UTC',
  enrolled_by         UUID        REFERENCES users(id),
  status              TEXT        NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','paused','completed','replied','opted_out','bounced','error')),
  current_step        INTEGER     NOT NULL DEFAULT 1,
  enrolled_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at         TIMESTAMPTZ,
  pause_reason        TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One active enrollment per contact per sequence at a time
  UNIQUE (sequence_id, contact_email)
);

CREATE INDEX idx_seq_enrollments_tenant_status
  ON sequence_enrollments (tenant_id, status, enrolled_at DESC);

CREATE INDEX idx_seq_enrollments_sequence
  ON sequence_enrollments (sequence_id, status);

CREATE INDEX idx_seq_enrollments_contact
  ON sequence_enrollments (contact_id, status)
  WHERE contact_id IS NOT NULL;

-- ── Sequence Step Executions ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sequence_step_executions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  enrollment_id   UUID        NOT NULL REFERENCES sequence_enrollments(id) ON DELETE CASCADE,
  step_id         UUID        NOT NULL REFERENCES sequence_steps(id),
  step_number     INTEGER     NOT NULL,
  type            TEXT        NOT NULL CHECK (type IN ('email', 'call', 'linkedin_task')),
  status          TEXT        NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','scheduled','sent','delivered','failed','skipped','replied','bounced')),
  scheduled_at    TIMESTAMPTZ,
  executed_at     TIMESTAMPTZ,
  -- Analytics
  opens           INTEGER     NOT NULL DEFAULT 0 CHECK (opens >= 0),
  clicks          INTEGER     NOT NULL DEFAULT 0 CHECK (clicks >= 0),
  replied_at      TIMESTAMPTZ,
  bounced_at      TIMESTAMPTZ,
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_seq_step_exec_pending
  ON sequence_step_executions (tenant_id, scheduled_at)
  WHERE status = 'scheduled';

CREATE INDEX idx_seq_step_exec_enrollment
  ON sequence_step_executions (enrollment_id, step_number);

-- Back-fill FK on email_messages → sequence_step_executions
ALTER TABLE email_messages
  ADD CONSTRAINT fk_email_message_step_exec
  FOREIGN KEY (sequence_step_execution_id)
  REFERENCES sequence_step_executions(id)
  ON DELETE SET NULL;

-- ── Phone Calls ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS phone_calls (
  id                            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                     UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id                       UUID        REFERENCES users(id),
  contact_id                    UUID,                               -- nullable snapshot
  contact_email                 TEXT,
  contact_name                  TEXT,
  direction                     TEXT        NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  to_number                     TEXT        NOT NULL,
  from_number                   TEXT        NOT NULL,
  provider                      TEXT        NOT NULL DEFAULT 'twilio'
                                CHECK (provider IN ('twilio', 'nooks', 'orum', 'manual')),
  provider_call_sid             TEXT,                               -- Twilio CallSid or external ref
  status                        TEXT        NOT NULL DEFAULT 'initiated'
                                CHECK (status IN ('initiated','ringing','in-progress','completed','failed','no-answer','busy','canceled')),
  disposition                   TEXT        CHECK (disposition IN ('connected','voicemail','no-answer','busy','bad-number','do-not-call')),
  duration_seconds              INTEGER     CHECK (duration_seconds >= 0),
  -- Recording: S3 key stored (not URL — presigned URLs generated on demand)
  recording_s3_key              TEXT,
  recording_consent_confirmed   BOOLEAN     NOT NULL DEFAULT false,
  notes                         TEXT,
  sequence_step_execution_id    UUID        REFERENCES sequence_step_executions(id) ON DELETE SET NULL,
  started_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at                      TIMESTAMPTZ,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_phone_calls_tenant_user
  ON phone_calls (tenant_id, user_id, started_at DESC);

CREATE INDEX idx_phone_calls_contact
  ON phone_calls (tenant_id, contact_id, started_at DESC)
  WHERE contact_id IS NOT NULL;

-- ── Dialer Configurations ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dialer_configs (
  id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   UUID        NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  -- Native Twilio
  native_enabled              BOOLEAN     NOT NULL DEFAULT false,
  -- AES-256-GCM ciphertext of JSON: { accountSid, authToken, fromNumber }
  native_credentials_enc      TEXT,
  -- Iframe dialers — array of:
  --   { id, name, provider: 'nooks'|'orum'|'custom', embed_url, active }
  iframe_configs              JSONB       NOT NULL DEFAULT '[]',
  -- Which dialer is currently active for new calls
  active_dialer               TEXT        NOT NULL DEFAULT 'native'
                              CHECK (active_dialer IN ('native', 'iframe')),
  active_iframe_id            TEXT,                                 -- id from iframe_configs array
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Opt-Out Records ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS opt_out_records (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_email   TEXT        NOT NULL,
  contact_id      UUID,                                             -- nullable (may not be a CRM contact)
  channel         TEXT        NOT NULL DEFAULT 'email'
                  CHECK (channel IN ('email', 'phone', 'all')),
  reason          TEXT        NOT NULL DEFAULT 'unsubscribe'
                  CHECK (reason IN ('unsubscribe', 'gdpr_request', 'bounce', 'manual', 'complaint')),
  opted_out_by    UUID        REFERENCES users(id),                 -- NULL = automated (e.g. link click)
  notes           TEXT,
  opted_out_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One opt-out record per email per channel per tenant
  UNIQUE (tenant_id, contact_email, channel)
);

CREATE INDEX idx_opt_out_tenant_email
  ON opt_out_records (tenant_id, contact_email);

-- ── Outreach Usage (monthly quotas) ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS outreach_usage (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  month           TEXT        NOT NULL,                             -- 'YYYY-MM'
  emails_sent     INTEGER     NOT NULL DEFAULT 0 CHECK (emails_sent >= 0),
  calls_made      INTEGER     NOT NULL DEFAULT 0 CHECK (calls_made >= 0),
  UNIQUE (tenant_id, month)
);

CREATE INDEX idx_outreach_usage_tenant
  ON outreach_usage (tenant_id, month DESC);

-- ── AI Provider Config (per-tenant) ──────────────────────────────────────────
-- Stored in tenants.settings JSONB under the key 'ai_outreach':
-- {
--   provider: 'anthropic' | 'openai_compat',
--   model: string,
--   api_key_enc: string,     -- AES-256-GCM encrypted API key (nullable = use system key)
--   base_url: string         -- for OpenAI-compatible endpoints (Ollama, etc.)
-- }
-- No separate table needed — piggybacking on tenants.settings as per existing pattern.

-- ── Triggers ──────────────────────────────────────────────────────────────────

CREATE TRIGGER email_threads_updated_at BEFORE UPDATE ON email_threads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER email_messages_updated_at BEFORE UPDATE ON email_messages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER sequences_updated_at BEFORE UPDATE ON sequences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER sequence_enrollments_updated_at BEFORE UPDATE ON sequence_enrollments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER sequence_step_executions_updated_at BEFORE UPDATE ON sequence_step_executions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER phone_calls_updated_at BEFORE UPDATE ON phone_calls
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER dialer_configs_updated_at BEFORE UPDATE ON dialer_configs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
