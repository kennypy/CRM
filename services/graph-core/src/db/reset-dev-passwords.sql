-- Reset dev user passwords to: Admin@nexcrm1
-- bcrypt hash (12 rounds) generated 2026-03-05
-- Run with: psql $DATABASE_URL -f reset-dev-passwords.sql

UPDATE users
SET password_hash = '$2a$12$u/hbllLOrDWUfx4NedQcAO5Kr2fXj5LAMwHhoepWnIKuEks5vU2E2'
WHERE email IN ('admin@nexcrm.dev', 'rep@nexcrm.dev')
  AND deleted_at IS NULL;

-- Verify
SELECT email, role, last_login_at
FROM users
WHERE email IN ('admin@nexcrm.dev', 'rep@nexcrm.dev');
