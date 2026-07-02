-- NexCRM Migration 020 — Tasks Table
-- Tasks are user-level work items (follow-ups, reminders, to-dos).

CREATE TABLE IF NOT EXISTS tasks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  description     TEXT,
  due_date        TIMESTAMPTZ,
  priority        TEXT NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('low', 'medium', 'high')),
  status          TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('pending', 'open', 'in_progress', 'done')),
  assignee_id     UUID REFERENCES users(id),
  related_to_type TEXT CHECK (related_to_type IN ('deal', 'contact', 'company')),
  related_to_id   UUID,
  source          TEXT,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tasks_tenant
  ON tasks(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tasks_assignee
  ON tasks(assignee_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_due_date
  ON tasks(tenant_id, due_date) WHERE deleted_at IS NULL AND status != 'done';

CREATE TRIGGER tasks_updated_at BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- custom_fields (moved here from 014: the tasks table must exist first)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS custom_fields JSONB NOT NULL DEFAULT '{}';
