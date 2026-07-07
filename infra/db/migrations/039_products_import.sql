-- 039_products_import.sql
-- Support Products CSV import with auto-created custom fields.
--
-- Adds a custom_fields JSONB bag to products (so imported columns that don't map
-- to a standard field can be stored), and widens the custom_field_definitions
-- entity_type CHECK to include 'product' and 'lead' — previously only
-- contact/company/deal/activity/task/custom_object were allowed, so you couldn't
-- define custom fields on products or leads at all.

BEGIN;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE custom_field_definitions
  DROP CONSTRAINT IF EXISTS custom_field_definitions_entity_type_check;

ALTER TABLE custom_field_definitions
  ADD CONSTRAINT custom_field_definitions_entity_type_check
  CHECK (entity_type IN (
    'contact','company','deal','lead','product','activity','task','custom_object'
  ));

COMMIT;
