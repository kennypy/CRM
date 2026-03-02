-- NexCRM Database Initialization
-- Runs on first Postgres start (docker-entrypoint-initdb.d)

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
-- CREATE EXTENSION IF NOT EXISTS "vector";     -- pgvector for embeddings
CREATE EXTENSION IF NOT EXISTS age;          -- Apache AGE graph extension

-- Load AGE
LOAD 'age';
SET search_path = ag_catalog, "$user", public;

-- Create the main CRM graph
SELECT create_graph('nexcrm_graph');

-- Reset search path
SET search_path = public;
