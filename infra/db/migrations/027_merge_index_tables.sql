-- Migration 027: Merge Index Tables
-- Denormalized lookup tables for workspace merge conflict detection.
-- Referenced by: services/auth/src/merge.ts

-- Person email index — fast lookup for merge conflict detection
CREATE TABLE IF NOT EXISTS person_email_index (
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email       TEXT NOT NULL,
    node_id     TEXT NOT NULL,              -- graph node ID (Person vertex)
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE person_email_index
    ADD CONSTRAINT uq_person_email_index_tenant_email
    UNIQUE (tenant_id, email);

CREATE INDEX idx_person_email_index_node ON person_email_index (node_id);

-- Company domain index — fast lookup for merge conflict detection
CREATE TABLE IF NOT EXISTS company_domain_index (
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    domain      TEXT NOT NULL,
    node_id     TEXT NOT NULL,              -- graph node ID (Company vertex)
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE company_domain_index
    ADD CONSTRAINT uq_company_domain_index_tenant_domain
    UNIQUE (tenant_id, domain);

CREATE INDEX idx_company_domain_index_node ON company_domain_index (node_id);
