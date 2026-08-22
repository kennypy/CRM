-- Migration 027: Merge Index Tables
-- Denormalized lookup tables for workspace merge conflict detection.
-- Referenced by: services/auth/src/merge.ts
--
-- NOTE: 002_entity_resolution_indexes.sql already creates both tables (with an
-- id PK, deleted_at, and UNIQUE (tenant_id, email/domain)). Everything here is
-- guarded so that on a fresh database this migration is a no-op apart from the
-- node_id indexes — previously it stacked a second, redundant unique
-- constraint on top of 002's.

CREATE TABLE IF NOT EXISTS person_email_index (
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email       TEXT NOT NULL,
    node_id     TEXT NOT NULL,              -- graph node ID (Person vertex)
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, email)
);

CREATE INDEX IF NOT EXISTS idx_person_email_index_node ON person_email_index (node_id);

CREATE TABLE IF NOT EXISTS company_domain_index (
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    domain      TEXT NOT NULL,
    node_id     TEXT NOT NULL,              -- graph node ID (Company vertex)
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, domain)
);

CREATE INDEX IF NOT EXISTS idx_company_domain_index_node ON company_domain_index (node_id);
