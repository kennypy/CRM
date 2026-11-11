-- Production-volume seed for load testing: one 120-user sales org.
--
--   psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/load-test/seed.sql
--
-- Volumes (override with -v): 20k accounts, 100k contacts + 10k leads,
-- 50k opportunities, 1M activities (relational row + graph vertex + link to a
-- contact, exactly as the API writes them), 300k events.
-- Writes straight into the tables (bypassing the API) — doing this through the
-- API would take hours. Re-running replaces the previous load tenant.
\if :{?companies}  \else \set companies 20000   \endif
\if :{?contacts}   \else \set contacts 100000   \endif
\if :{?leads}      \else \set leads 10000       \endif
\if :{?deals}      \else \set deals 50000       \endif
\if :{?activities} \else \set activities 1000000 \endif
\if :{?events}     \else \set events 300000     \endif
\set tenant '''77777777-7777-7777-7777-777777777777'''

LOAD 'age';
SET search_path = ag_catalog, public;
\timing on

-- ── clean previous run ──────────────────────────────────────────────────────
DELETE FROM nexcrm_graph."PARTICIPATED_IN" e USING nexcrm_graph."Activity" a
  WHERE e.end_id = a.id AND a.properties @> format('{"tenant_id": "%s"}', :tenant)::agtype;
DELETE FROM nexcrm_graph."WORKS_AT" e USING nexcrm_graph."Person" p
  WHERE e.start_id = p.id AND p.properties @> format('{"tenant_id": "%s"}', :tenant)::agtype;
DELETE FROM nexcrm_graph."INFLUENCES" e USING nexcrm_graph."Person" p
  WHERE e.start_id = p.id AND p.properties @> format('{"tenant_id": "%s"}', :tenant)::agtype;
DELETE FROM nexcrm_graph."INVOLVED_IN" e USING nexcrm_graph."Company" c
  WHERE e.start_id = c.id AND c.properties @> format('{"tenant_id": "%s"}', :tenant)::agtype;
DELETE FROM nexcrm_graph."Activity" WHERE properties @> format('{"tenant_id": "%s"}', :tenant)::agtype;
DELETE FROM nexcrm_graph."Person"   WHERE properties @> format('{"tenant_id": "%s"}', :tenant)::agtype;
DELETE FROM nexcrm_graph."Deal"     WHERE properties @> format('{"tenant_id": "%s"}', :tenant)::agtype;
DELETE FROM nexcrm_graph."Company"  WHERE properties @> format('{"tenant_id": "%s"}', :tenant)::agtype;
DELETE FROM activities WHERE tenant_id = :tenant;
DELETE FROM crm_events WHERE tenant_id = :tenant::uuid;
DELETE FROM tenants WHERE id = :tenant::uuid;   -- cascades to users and tenant-scoped rows

-- ── tenant + 120 users: 1 admin, 2 VPs, 12 managers, 105 reps ───────────────
INSERT INTO tenants (id, name, slug, plan) VALUES (:tenant::uuid, 'Load Test Co', 'loadco', 'enterprise');

CREATE TEMP TABLE lu AS
SELECT n, md5('load-user-' || n)::uuid AS id,
       CASE WHEN n = 1 THEN 'admin' WHEN n <= 15 THEN 'manager' ELSE 'rep' END AS role
FROM generate_series(1, 120) n;

INSERT INTO users (id, tenant_id, email, first_name, last_name, role, can_quote, capabilities, manager_id)
SELECT id, :tenant::uuid, 'user' || n || '@loadco.test', 'User', 'N' || n, role, true,
       '{"can_quote": true, "can_discount": true, "can_campaigns": true}'::jsonb,
       CASE WHEN n <= 3 THEN NULL                                     -- admin, 2 VPs
            WHEN n <= 15 THEN md5('load-user-' || (2 + n % 2))::uuid  -- managers → a VP
            ELSE md5('load-user-' || (4 + n % 12))::uuid END          -- reps → a manager
FROM lu;

-- Private sharing model, as a real 120-seat org would run it.
INSERT INTO record_permission_defaults (tenant_id, entity_type, owner_access, team_access, org_access)
SELECT :tenant::uuid, e, 'read_write_delete', 'none', 'none' FROM unnest(ARRAY['deal','contact','company','quote']) e
ON CONFLICT DO NOTHING;

-- rep n (1..105) → user id
CREATE TEMP TABLE reps AS SELECT n - 15 AS r, id FROM lu WHERE n > 15;
CREATE UNIQUE INDEX ON reps (r);

-- ── accounts ────────────────────────────────────────────────────────────────
CREATE TEMP TABLE lc AS
SELECT n, md5('load-co-' || n)::uuid AS id, 1 + n % 105 AS r,
       _graphid(_label_id('nexcrm_graph', 'Company')::int, nextval('nexcrm_graph."Company_id_seq"')) AS gid
FROM generate_series(1, :companies) n;
CREATE UNIQUE INDEX ON lc (n);

INSERT INTO nexcrm_graph."Company" (id, properties)
SELECT lc.gid, format(
  '{"id": "%s", "name": "Load Account %s", "tier": "%s", "domain": "load-%s.example", "source": "import", "country": "%s", "website": "", "industry": "%s", "owner_id": "%s", "headcount": %s, "tenant_id": "%s", "churned_at": "", "created_at": "%s", "updated_at": "%s", "churn_reason": "", "custom_fields": "{}", "account_status": "%s"}',
  lc.id, lc.n, (ARRAY['smb','mid_market','enterprise'])[1 + lc.n % 3], lc.n,
  (ARRAY['US','GB','DE','BR','FR'])[1 + lc.n % 5], (ARRAY['software','manufacturing','finance','health','retail'])[1 + lc.n % 5],
  reps.id, 10 + (lc.n * 37) % 5000, :tenant,
  to_char(now() - ((lc.n % 700) || ' days')::interval, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  to_char(now() - ((lc.n % 90) || ' days')::interval, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  (ARRAY['prospect','prospect','customer','customer','churned'])[1 + lc.n % 5])::agtype
FROM lc JOIN reps ON reps.r = lc.r;

-- ── contacts (linked to accounts) + leads (unlinked) ────────────────────────
CREATE TEMP TABLE lp AS
SELECT n, md5('load-person-' || n)::uuid AS id, n > :contacts AS is_lead,
       CASE WHEN n <= :contacts THEN 1 + n % :companies END AS cn,
       _graphid(_label_id('nexcrm_graph', 'Person')::int, nextval('nexcrm_graph."Person_id_seq"')) AS gid
FROM generate_series(1, :contacts + :leads) n;
CREATE UNIQUE INDEX ON lp (n);

INSERT INTO nexcrm_graph."Person" (id, properties)
SELECT lp.gid, format(
  '{"id": "%s", "email": "p%s@load-%s.example", "phone": "+1555%s", "title": "%s", "source": "%s", "is_lead": %s, "owner_id": "%s", "last_name": "%s", "seniority": "%s", "tenant_id": "%s", "created_at": "%s", "first_name": "%s", "updated_at": "%s", "custom_fields": "{}"%s}',
  lp.id, lp.n, coalesce(lp.cn, lp.n), lpad((lp.n % 10000000)::text, 7, '0'),
  (ARRAY['VP Sales','CTO','Buyer','Engineer','CFO','Director'])[1 + lp.n % 6],
  (ARRAY['web','event','referral','import'])[1 + lp.n % 4], lp.is_lead::text, reps.id,
  (ARRAY['Smith','Garcia','Chen','Silva','Muller','Okafor','Tanaka','Rossi'])[1 + lp.n % 8] || lp.n,
  (ARRAY['c_level','vp','director','manager','ic'])[1 + lp.n % 5], :tenant,
  to_char(now() - ((lp.n % 700) || ' days')::interval, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  (ARRAY['Ana','Ben','Chloe','Dev','Eli','Fay','Gus','Hana'])[1 + (lp.n / 8) % 8],
  to_char(now() - ((lp.n % 90) || ' days')::interval, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  CASE WHEN lp.is_lead THEN format(', "lead_status": "%s"', (ARRAY['new','working','nurturing'])[1 + lp.n % 3]) ELSE '' END)::agtype
FROM lp JOIN reps ON reps.r = 1 + coalesce(lp.cn, lp.n) % 105;

INSERT INTO nexcrm_graph."WORKS_AT" (start_id, end_id, properties)
SELECT lp.gid, lc.gid, '{"is_current": true}'::agtype FROM lp JOIN lc ON lc.n = lp.cn;

-- ── opportunities: 60% closed, 40% open across stages ───────────────────────
CREATE TEMP TABLE ld AS
SELECT n, md5('load-deal-' || n)::uuid AS id, 1 + n % :companies AS cn,
       (ARRAY['closed_won','closed_won','closed_lost','closed_won','closed_lost','closed_lost',
              'lead','qualified','discovery','proposal','negotiation','discovery','qualified','proposal','negotiation'])[1 + n % 15] AS stage,
       _graphid(_label_id('nexcrm_graph', 'Deal')::int, nextval('nexcrm_graph."Deal_id_seq"')) AS gid
FROM generate_series(1, :deals) n;
CREATE UNIQUE INDEX ON ld (n);

INSERT INTO nexcrm_graph."Deal" (id, properties)
SELECT ld.gid, format(
  '{"id": "%s", "name": "Load Opportunity %s", "stage": "%s", "value": %s, "source": "user", "currency": "USD", "owner_id": "%s", "archetype": "simple", "tenant_id": "%s", "close_date": "%s", "created_at": "%s", "risk_flags": "[]", "updated_at": "%s", "is_expansion": false, "custom_fields": "{}", "reality_score": %s}',
  ld.id, ld.n, ld.stage, 5000 + (ld.n * 7919) % 245000, reps.id, :tenant,
  to_char(CASE WHEN ld.stage LIKE 'closed%' THEN now() - ((ld.n % 540) || ' days')::interval ELSE now() + ((ld.n % 120 - 20) || ' days')::interval END, 'YYYY-MM-DD'),
  to_char(now() - ((60 + ld.n % 600) || ' days')::interval, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  to_char(now() - ((ld.n % 75) || ' days')::interval, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 20 + ld.n % 70)::agtype
FROM ld JOIN lc ON lc.n = ld.cn JOIN reps ON reps.r = lc.r;

INSERT INTO nexcrm_graph."INVOLVED_IN" (start_id, end_id, properties)
SELECT lc.gid, ld.gid, '{"type": "buyer"}'::agtype FROM ld JOIN lc ON lc.n = ld.cn;

-- contact roles: 1–2 contacts of the account per opportunity
INSERT INTO nexcrm_graph."INFLUENCES" (start_id, end_id, properties)
SELECT lp.gid, ld.gid, format('{"role": "%s", "sentiment": 0, "is_primary": %s, "influence_score": %s}',
         CASE WHEN k = 0 THEN 'champion' ELSE 'economic_buyer' END, (k = 0)::text, 85 - 30 * k)::agtype
FROM ld CROSS JOIN generate_series(0, 1) k
JOIN lp ON lp.n = ld.cn - 1 + k * :companies AND lp.cn = ld.cn;

-- ── activities: relational row + graph vertex + PARTICIPATED_IN ─────────────
CREATE TEMP TABLE la AS
SELECT n, md5('load-act-' || n)::uuid AS id, 1 + n % :contacts AS pn, 1 + n % :deals AS dn,
       now() - ((n % 1040000) || ' minutes')::interval AS at,        -- spread over ~2 years
       _graphid(_label_id('nexcrm_graph', 'Activity')::int, nextval('nexcrm_graph."Activity_id_seq"')) AS gid
FROM generate_series(1, :activities) n;

INSERT INTO activities (id, tenant_id, type, direction, subject, summary, occurred_at, source, deal_id, company_id, created_by)
SELECT la.id, :tenant, (ARRAY['email','call','meeting','note'])[1 + la.n % 4], (ARRAY['outbound','inbound'])[1 + la.n % 2],
       'Load activity ' || la.n, '', la.at, 'user',
       CASE WHEN la.n % 3 = 0 THEN ld.id END, lc.id, reps.id
FROM la JOIN lp ON lp.n = la.pn JOIN lc ON lc.n = lp.cn JOIN reps ON reps.r = lc.r JOIN ld ON ld.n = la.dn;

INSERT INTO nexcrm_graph."Activity" (id, properties)
SELECT la.gid, format(
  '{"id": "%s", "type": "%s", "source": "user", "subject": "Load activity %s", "summary": "", "direction": "%s", "sentiment": 0, "tenant_id": "%s", "created_at": "%s", "updated_at": "%s", "external_id": "", "occurred_at": "%s", "duration_seconds": 0}',
  la.id, (ARRAY['email','call','meeting','note'])[1 + la.n % 4], la.n, (ARRAY['outbound','inbound'])[1 + la.n % 2], :tenant,
  to_char(la.at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), to_char(la.at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), to_char(la.at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))::agtype
FROM la;

INSERT INTO nexcrm_graph."PARTICIPATED_IN" (start_id, end_id, properties)
SELECT lp.gid, la.gid, '{}'::agtype FROM la JOIN lp ON lp.n = la.pn;

-- ── event history (already processed, so workers do not replay it) ──────────
INSERT INTO crm_events (tenant_id, event_type, source, entity_type, entity_id, payload, created_at, processed_at)
SELECT :tenant::uuid,
       CASE WHEN g.n % 10 < 6 THEN 'deal.stage_changed' WHEN g.n % 10 < 8 THEN 'deal.updated'
            WHEN ld.stage = 'closed_won' THEN 'deal.closed_won' WHEN ld.stage = 'closed_lost' THEN 'deal.closed_lost' ELSE 'deal.created' END,
       'user', 'deal', ld.id,
       jsonb_build_object('stage', ld.stage, 'value', 5000 + (ld.n * 7919) % 245000, 'currency', 'USD'),
       now() - ((g.n % 500000) || ' minutes')::interval, now()
FROM generate_series(1, :events) g(n) JOIN ld ON ld.n = 1 + g.n % :deals;

ANALYZE nexcrm_graph."Person"; ANALYZE nexcrm_graph."Company"; ANALYZE nexcrm_graph."Deal"; ANALYZE nexcrm_graph."Activity";
ANALYZE nexcrm_graph."WORKS_AT"; ANALYZE nexcrm_graph."INVOLVED_IN"; ANALYZE nexcrm_graph."INFLUENCES"; ANALYZE nexcrm_graph."PARTICIPATED_IN";
ANALYZE activities; ANALYZE crm_events;

SELECT 'accounts' AS what, count(*) FROM lc UNION ALL SELECT 'people', count(*) FROM lp
UNION ALL SELECT 'opportunities', count(*) FROM ld UNION ALL SELECT 'activities', count(*) FROM la;
