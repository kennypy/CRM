-- Platform tenant for super admin users.
-- Super admins belong to this reserved tenant and can manage all other tenants.

INSERT INTO tenants (name, slug, plan, data_region, settings)
VALUES (
  'Platform',
  '_platform',
  'enterprise',
  'us',
  '{}'::jsonb
)
ON CONFLICT (slug) DO NOTHING;
