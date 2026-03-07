-- Workspace merge tracking.
-- Records merge jobs with conflict data and resolution state.

CREATE TABLE IF NOT EXISTS workspace_merges (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id     UUID NOT NULL REFERENCES tenants(id),
  target_id     UUID NOT NULL REFERENCES tenants(id),
  initiated_by  UUID NOT NULL REFERENCES users(id),
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'previewing', 'approved', 'in_progress', 'completed', 'failed', 'cancelled')),
  conflict_data JSONB NOT NULL DEFAULT '{}',
  resolutions   JSONB NOT NULL DEFAULT '{}',
  summary       JSONB,
  error_message TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ
);

CREATE INDEX idx_workspace_merges_source ON workspace_merges(source_id);
CREATE INDEX idx_workspace_merges_target ON workspace_merges(target_id);
CREATE INDEX idx_workspace_merges_status ON workspace_merges(status) WHERE status NOT IN ('completed', 'cancelled', 'failed');
