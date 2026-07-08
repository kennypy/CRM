-- NexCRM Migration 046 — Remove the Vintage.br support-desk subsystem
--
-- The support-ticket / Vintage.br marketplace integration (migrations 032 & 033)
-- was single-operator scaffolding: the tables had no tenant_id and access was
-- gated by a single SUPPORT_OPERATOR_TENANT_ID env var, which does not fit
-- NexCRM's multi-tenant model. The application code, routes, workers, admin UI,
-- and the 032/033 migration files have been removed; this drops the now-orphaned
-- tables on databases where they were already created.
--
-- Forward-only and idempotent: on a fresh database (032/033 no longer exist)
-- these tables were never created, so every DROP … IF EXISTS is a no-op.

DROP TABLE    IF EXISTS support_outbound_jobs        CASCADE;
DROP TABLE    IF EXISTS support_webhook_deliveries   CASCADE;
DROP TABLE    IF EXISTS support_ticket_messages      CASCADE;
DROP TABLE    IF EXISTS support_tickets              CASCADE;
DROP SEQUENCE IF EXISTS support_tickets_vintage_seq  CASCADE;
