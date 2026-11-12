# Mobile app audit: Flutter client vs. API gateway

Static read of `apps/mobile/lib` (71 Dart files, about 180 network call sites) against the gateway route table and the downstream schemas. The contract comparison below is from reading both sides.

**Analyzer run (added after the static read):** `flutter analyze` on Flutter 3.24.5 reports 172 issues, **11 of them errors, so the app does not compile**: the nine missing `Endpoints` getters listed in item 1 below, plus two uses of `CardThemeData` in `lib/core/theme/app_theme.dart:19,74`, which only exists in newer Flutter releases (no Flutter version is pinned anywhere in the repo). `flutter test` has nothing to run: there is no `test/` directory. There is no `android/` or `ios/` project, so no installable build can be produced. The app was not run on a device or emulator.

Path shorthand used below:

- `lib/` = `apps/mobile/lib/`
- `gw/` = `services/api-gateway/src/routes/`
- `gc/` = `services/graph-core/src/routes/`
- `auth/` = `services/auth/src/`
- `outreach/` = `services/outreach/src/routes/`

## Summary

1. **Usable by a rep today: no.** The app does not compile, and once that is fixed most write paths a rep needs are rejected by the server.
2. **Build blocker:** nine references to `Endpoints` members that are commented out (`admin_screen.dart`, `insights_screen.dart`), and there is no `android/` or `ios/` project, no tests and no CI job.
3. **Write blockers:** creating a company, task, activity, call log or note always returns 400; a deal without a value and a contact with four of the eight seniority choices also return 400.
4. **Misleading reads:** the Leads screen lists all contacts with invented scores, "Convert to contact" reports success and changes nothing, the pipeline hides `lead` and `qualified` deals, and contacts beyond the first 25 cannot be reached.
5. **Session and fake data:** any failed token refresh (including a network blip) wipes the session and leaves the app stuck on error screens; logout never reaches the gateway; eight screens show built-in demo data when the API returns nothing or fails.

What does line up: login (tenant slug, email, password), token rotation on refresh, contact/company/deal/quote/notification list reads, deal stage change from the deal detail screen, quote creation, tags, forecasting list and summary, and the report builder tab.

## Broken — cannot work

| # | Screen | What the app calls | What the server expects | Evidence |
|---|---|---|---|---|
| 1 | Whole app (build) | `Endpoints.adminRoles`, `adminSystemHealth`, `adminDataRetention`, `adminGdprRequests`, `adminDataExport`, `insightsActivity`, `insightsEngagement`, `insightsPipeline`, `insightsTeam` | These getters are commented out, so the code does not compile. No matching gateway routes exist either. | `lib/features/admin/admin_screen.dart:162,172,180,188,1157`; `lib/features/insights/insights_screen.dart:124,126,128,130`; `lib/core/api/endpoints.dart:93-96,145-153` |
| 2 | New company | `POST /api/v1/companies` with `name, industry, website, phone, country, address`; no `domain` | `domain` is required. `phone` and `address` are not in the schema. `website` must be a full URL. | `lib/features/companies/company_form_screen.dart:40-49`; `gc/companies.ts:21-23,27` |
| 3 | New task, edit task, tick task complete | `status` is always sent as `pending`, `in_progress` or `completed` | `status` must be `open`, `in_progress` or `done`, so create and complete return 400 | `lib/features/tasks/task_form_screen.dart:20,44,242`; `lib/features/tasks/tasks_screen.dart:65,79`; `gc/tasks.ts:16` |
| 4 | New activity | `occurredAt: _dateTime.toIso8601String()` on a local `DateTime` (no `Z`); type list includes `task` | `occurredAt` is `z.string().datetime()` (zod 3.25, UTC `Z` required); type must be `email, call, meeting, note, document` | `lib/features/activities/activity_form_screen.dart:7,94`; `gc/activities.ts:21,34` |
| 5 | Contact detail: log call, add note | `POST /api/v1/activities` with `contactId, type, notes` | `occurredAt` is required, so both return 400. The text field is `summary`, not `notes`. The call log failure is swallowed; the note shows "Failed to save note". | `lib/features/contacts/contact_detail_screen.dart:468-472,553-558`; `gc/activities.ts:30,34` |
| 6 | New deal with the value left empty | `value` is omitted (the form does not require it) | `value` is a required number | `lib/features/deals/deal_form_screen.dart:61-63,107-115`; `gc/deals.ts:32` |
| 7 | New contact with seniority Senior, Mid-Level, Junior or Intern | `seniority: senior / mid / junior / intern` | Enum is `individual_contributor, manager, director, vp, c_suite, founder` | `lib/features/contacts/contact_form_screen.dart:24-33,68`; `gc/contacts.ts:24-26,34` |
| 8 | Task assignee picker, contact owner picker (any non-admin user) | `GET /api/v1/users` | Admin only, so a rep or manager gets 403. The picker stays empty and the owner shows "Unassigned". | `lib/features/tasks/task_form_screen.dart:136-137`; `lib/features/contacts/contact_detail_screen.dart:199`; `gw/users.ts:102` |
| 9 | Login: "Forgot password?" | Navigates to `/forgot-password` | No such route in the app router; `AuthService.forgotPassword` is never called | `lib/features/auth/login_screen.dart:152`; `lib/app.dart:85-86`; `lib/core/auth/auth_service.dart:108` |
| 10 | Settings: change password | `POST /auth/change-password` | No such route registered on the gateway or in the auth service (grepped both) | `lib/features/settings/security_settings_screen.dart:65`; `gw/auth.ts:49-81` |
| 11 | Dashboard: upcoming tasks | `GET /api/v1/tasks?status=pending` | `status` enum is `open, in_progress, done`, so 400; the section is always empty | `lib/features/dashboard/dashboard_screen.dart:42`; `gc/tasks.ts:25` |
| 12 | Dashboard: stale deals | `GET /api/v1/deals?sort=lastActivityAt&order=asc` | `sort` enum is `value, updated, close_date`, so 400; the app then derives the list itself | `lib/features/dashboard/dashboard_screen.dart:45-49`; `gc/deals.ts:59` |
| 13 | Dashboard: team leaderboard (managers) | `GET /api/v1/reports/run?type=team_performance` | Only `POST /reports/run` exists; the GET falls into `GET /reports/:id` with id `run` | `lib/features/dashboard/dashboard_screen.dart:57-60`; `gw/reports.ts:557,611` |
| 14 | AI assistant | `POST /api/v1/ai/nl` with `{query}`; reads `res.data['data']` | Gateway forwards `command` or `input` only, so the engine receives an empty command; the response is a `text/event-stream`, not a JSON envelope | `lib/features/ai/ai_screen.dart:38-45`; `gw/ai.ts:41-44`; `services/ai-engine/src/routers/nl_command.py:91-93` |
| 15 | New workflow | `trigger: 'deal_stage_change'` (a string), `isActive` | `trigger` must be an object (400), and must use a catalog trigger type (422). The flag is `is_active`. | `lib/features/workflows/workflow_form_screen.dart:21-26,40-46`; `gw/workflows.ts:28,31,110-119` |
| 16 | Workflow on/off switch | `PATCH /workflows/:id {isActive}` | Key is `is_active`; the unknown key is dropped and the server returns 400 `NOTHING_TO_UPDATE` | `lib/features/workflows/workflows_screen.dart:44-47`; `gw/workflows.ts:41,184` |
| 17 | New sequence | `settings.sendDays` as an object `{mon: true, ...}`, `settings.sendWindow`; then `POST /steps` with `{steps: [...]}` in snake_case | `sendDays` is an array of ints 1-7 (400). Window is `sendStart` / `sendEnd`. Steps are posted one at a time with `stepNumber, type, dayOffset...`. Create also needs manager role. | `lib/features/sequences/sequence_form_screen.dart:40-46,65-87`; `outreach/sequences.ts:22-27,31-33,191`; `gw/outreach.ts:32` |
| 18 | New report (`/reports/new` screen) | `spec.fields` as strings (`"deals.name"`), `spec.filters` as an array, `spec.period` as a string | `fields` is an array of `{source, field}`, `filters` is `{logic, conditions}`, `period` is `{field, range}`. Preview and save both return 400. | `lib/features/reports/report_form_screen.dart:65-75,80,104`; `gw/reports.ts:224-231,241` |
| 19 | Coaching | `GET /coaching/alerts`, `/reps`, `/skills`, `/meetings`, `/recommendations`, `/metrics` | None registered. The gateway has `/live-calls`, `/call-reviews`, `/scorecards/:repId`, `/coaching-plans`, `/best-practices`, `/ai-insights/:repId`. | `lib/features/coaching/coaching_screen.dart:149-154`; `lib/core/api/endpoints.dart:99-104`; `gw/coaching.ts:13,27,62,102,137,149,163` |
| 20 | Compliance | `GET /compliance/mirroring` (one of four parallel calls) | Route is `/compliance/mirror`. The 404 fails the whole `Future.wait`, so the screen always shows demo data. All compliance routes are admin only. | `lib/features/compliance/compliance_screen.dart:144-149,173-181`; `lib/core/api/endpoints.dart:88`; `gw/compliance.ts:110,337` |
| 21 | Territories | Parses `rep_count` / `account_count` with `as int` and `quota` with `.toDouble()` | `COUNT(*)` and numeric columns come back from Postgres as strings (no type parser is configured in the gateway), so parsing throws and the screen shows demo territories even when real ones exist | `lib/features/territories/territories_screen.dart:59-63,477-481`; `gw/territories.ts:19-22` |
| 22 | New campaign with type Web, SMS, Ads or Direct mail | `type: web / sms / ads / direct_mail` | Enum is `email, social, event, webinar, content, paid_search, paid_social, abm, referral, other` | `lib/features/marketing/campaigns_screen.dart:72-83,550`; `gw/campaigns.ts:21,27` |
| 23 | Settings: quoting, communications | `PATCH /api/v1/tenant {settings: {...}}` | Schema accepts `defaultCurrency, locale, timezone, discountApprovalThreshold, roleThresholds, tcvTiers` only. Result is 400 `NOTHING_TO_UPDATE`. `GET /tenant` returns no `settings` object either. | `lib/features/settings/quoting_settings_screen.dart:65-69,105-111`; `lib/features/settings/communications_settings_screen.dart:60-63,88`; `gw/tenant.ts:16-29,124` |
| 24 | Settings: activate / deactivate user | `PATCH /users/:id {status}` | `status` is not in the schema, so 400 `NOTHING_TO_UPDATE`. The real routes are `POST /users/:id/deactivate` and `/reactivate`. | `lib/features/settings/users_settings_screen.dart:68,88-90`; `gw/users.ts:46-58,350`; `gw/users-lifecycle.ts:192,200` |
| 25 | Settings: new custom field | `entityType, fieldKey, fieldLabel, fieldType, isRequired`, options as strings | snake_case keys (`entity_type, field_key, field_label, field_type, is_required`); options are objects | `lib/features/settings/custom_fields_settings_screen.dart:117-127`; `gw/custom-fields.ts:23-34` |
| 26 | Settings: new custom object | `objectKey, objectLabel, objectLabelPlural` | `object_key, object_label, object_label_plural` | `lib/features/settings/custom_objects_settings_screen.dart:82-88`; `gw/custom-objects.ts:30-33` |
| 27 | Settings: field permissions, sharing defaults | `{entityType, field, role, access}` and `{entityType, scope, access}` | `{entity_type, field_name, role, access_level}` and `{entity_type, owner_access, team_access, org_access}` | `lib/features/settings/permissions_settings_screen.dart:65-70,83-87`; `gw/permissions.ts:37-49` |
| 28 | Admin: duplicates merge and stats | `POST /api/v1/admin/duplicates/merge`, `GET /api/v1/admin/duplicates/stats` | Only `GET /duplicates` and `POST /duplicates/dismiss` are registered | `lib/features/admin/dedup_screen.dart:95,119`; `lib/core/api/endpoints.dart:137-138`; `gw/dedup.ts:198,210` |
| 29 | Admin: merge jobs list | `GET /api/admin/merges` | Only `POST /merges`, `GET /merges/:id`, `PATCH`, `/execute`, `/cancel` | `lib/features/admin/merges_screen.dart:53`; `gw/admin.ts:36-40` |
| 30 | Admin: create sub-workspace | `POST /api/admin/tenants/:id/children` | `children` is GET only; create is `POST /tenants/:id/sub-workspaces` | `lib/features/admin/workspaces_screen.dart:272-273,708-709`; `gw/admin.ts:28-29` |
| 31 | Admin: export audit log | `GET /api/v1/compliance/audit-log/export` | `POST` only | `lib/features/admin/admin_screen.dart:924`; `gw/compliance.ts:475` |

Checked and found consistent at path, body and response level: login, refresh, deals list / detail / stage patch, contacts list (first page) / detail / owner patch, companies list / detail, quotes list / create / send, products list / create / update, tags read / add / remove, notes read, notifications list / read / mark-all-read, forecasting list / summary / compute (manager only), anomalies list / summary / patch, lead scoring list, sequences list / steps / enrollments / status / enroll, custom object records, report builder tab and quick query, saved reports list / run / delete, admin tenants list / detail / users / stats, admin report types / run, API keys, `users/me`.

## Works but wrong or misleading

| # | Screen | Problem | Evidence |
|---|---|---|---|
| 1 | Pipeline | The tab list is `discovery, proposal, negotiation, closed_won, closed_lost`. Deals in `lead` or `qualified` are loaded but never shown. The new-deal form defaults to `lead`, so a deal created on the phone disappears from the pipeline. | `lib/features/deals/deals_screen.dart:10,67-70`; `lib/features/deals/deal_form_screen.dart:30`; `gc/deals.ts:24-27` |
| 2 | Leads | Calls `GET /contacts?stage=lead`. `stage` is not a contacts filter and is dropped, so the screen lists the first 50 contacts of any kind. The server filter is `isLead=true` or `GET /api/v1/leads`. | `lib/features/leads/leads_screen.dart:51-54`; `lib/core/api/endpoints.dart:77`; `gc/contacts.ts:45-56`; `gw/leads.ts:110-117` |
| 3 | Leads: "Convert to contact" | Sends `PATCH /contacts/:id {stage: 'contact'}`. The key is dropped, the server returns 200 having changed nothing, and the app shows "Converted to contact". Real conversion is `POST /api/v1/leads/:id/convert`. | `lib/features/leads/leads_screen.dart:65-75`; `gc/contacts.ts:28-43,343-377`; `gw/leads.ts:120` |
| 4 | Contacts list paging | Sends `page`; the server pages by `offset`, so every page is the first 25. The total is read from `data['total']`, but `data` is a list and the total is in `pagination.total`, so the app thinks there is one page. Contacts past the first 25 are reachable only by search. | `lib/features/contacts/contacts_screen.dart:60-63,81-87`; `gc/contacts.ts:54-55,149-151` |
| 5 | Contacts: lifecycle filter and stage change | `lifecycleStage` (subscriber, lead, mql, sql, opportunity, customer) does not exist on the server. The list filter is ignored. Changing the stage on a contact returns 200 with no change and shows "Stage updated". | `lib/features/contacts/contacts_screen.dart:33-39,65-67`; `lib/features/contacts/contact_detail_screen.dart:12-18,286-294`; `gc/contacts.ts:28-43` |
| 6 | Contact detail: GDPR preferences | `gdprConsent, doNotContact, communicationPreferences` are not contact fields. Save returns 200 with nothing stored and shows "GDPR preferences saved". | `lib/features/contacts/contact_detail_screen.dart:373-388`; `gc/contacts.ts:28-43` |
| 7 | Contact detail: deals; company detail: deals and activities | `GET /deals?contactId=`, `GET /deals?companyId=` and `GET /activities?companyId=` use filters the server does not have, so the sections show unrelated deals and activities (the first page for the tenant). | `lib/features/contacts/contact_detail_screen.dart:182-185`; `lib/features/companies/company_detail_screen.dart:46-47`; `gc/deals.ts:44-60`; `gc/activities.ts:49-57` |
| 8 | Deal detail | Reads `company_name / companyName`, `contactName`, `probability`, `notes`. The server returns `company.name`, `declaredProbability`, and no contact or notes, so Company, Contact and Probability always show "-". Notes typed in the deal form are dropped. | `lib/features/deals/deal_detail_screen.dart:119-126,167`; `lib/features/deals/deal_form_screen.dart:67-69`; `gc/deals.ts:29-42,620-629` |
| 9 | Task form | Sends `due_date`, `assignee_id`, `contact_id / company_id / deal_id`, `linked_entity_*`, `description`. The server takes `dueDate` (ISO datetime), `assigneeId`, `relatedToType`, `relatedToId`, and has no description. Once the status enum is fixed, tasks will save with title, priority and status only. The task list reads `due_date`; the server returns `dueDate`, so due dates and overdue markers never show. | `lib/features/tasks/task_form_screen.dart:244-264`; `lib/features/tasks/tasks_screen.dart:360`; `gc/tasks.ts:13-21,184` |
| 10 | Activity form and list | Form sends `body` and `duration`; the server takes `summary` and `durationSeconds`, and the form cannot link the activity to a contact or deal. The list casts `sentiment` to `String?` but the server returns a number, which throws when the row is built. The list reads `occurred_at / created_at` and `duration`; the server returns `occurredAt` and `durationSeconds`. | `lib/features/activities/activity_form_screen.dart:96-104`; `lib/features/activities/activities_screen.dart:178,180,219-220`; `gc/activities.ts:27-44,485` |
| 11 | Dashboard and pipeline totals | KPIs are summed client-side over the first 200 deals (server cap) with currencies mixed. "Revenue (30d)" is all closed-won value in that page, not 30 days. "Active Contacts" reads `data['total']` from a list and always shows "-". The server has an exact, sharing-aware `GET /deals/summary`. | `lib/features/dashboard/dashboard_screen.dart:40,83-104,129-133,338`; `lib/features/deals/deals_screen.dart:62,113-134`; `gc/deals.ts:57`; `gw/deals.ts:87` |
| 12 | Company detail | Reads `employees / size`, `phone`, `city`; the server returns `headcount` and has no phone or city. | `lib/features/companies/company_detail_screen.dart:150-153`; `gc/companies.ts:478` |
| 13 | Lead scoring and forecasting: factor breakdown | Reads `name, impact, evidence`. Server factors are `{factor, label, points, detail}`, so real factors render blank with impact 0. | `lib/features/lead_scoring/lead_scoring_screen.dart:588,608,650`; `lib/features/forecasting/forecasting_screen.dart:760-762`; `services/ai-engine/src/routers/scoring.py:324-338`; `gw/forecasting.ts:310` |
| 14 | Quotes | "Edit" opens a blank new-quote form. "Approve" returns 409 `NOT_SUBMITTED` unless the quote was submitted for approval elsewhere; the app has no submit action. A quote cannot be linked to a deal or company, and no price book can be chosen. Item count always shows 0 because the list omits items. | `lib/features/quotes/quotes_screen.dart:126,315,378`; `lib/features/quotes/quote_form_screen.dart:179-198`; `gw/quotes.ts:263,565,586-598` |
| 15 | Sequence analytics | Reads flat `totalEnrolled, active, completed, replied, openRate...`; the server nests them under `enrollments` and `rates`, so every metric shows 0. | `lib/features/sequences/sequences_screen.dart:498-511`; `outreach/sequences.ts:430,437` |
| 16 | Campaigns | Sends `offset` (server pages by `page`) and reads `res.data['total']` (server sends `pagination.total`), so only the first page is reachable. Reads `sent_count / opened_count / clicked_count`; the server returns `sent / opened / clicked`. Create sends `start_date, end_date, target_audience` in snake_case, which are dropped. | `lib/features/marketing/campaigns_screen.dart:127-129,141-142,558-565,1038-1040`; `gw/campaigns.ts:29-33,88-90,118` |
| 17 | Territories: create | Sends `owner` as free text (server takes `ownerId`); any error is swallowed and the sheet closes as if it worked. | `lib/features/territories/territories_screen.dart:619-631`; `gw/territories.ts:47-53` |
| 18 | Settings: workspace, users | Workspace `name` is not accepted by `PATCH /tenant` and is ignored. `reportsTo` is ignored; the server field is `managerId`. | `lib/features/settings/workspace_settings_screen.dart:104-108`; `lib/features/settings/users_settings_screen.dart:226,326`; `gw/tenant.ts:16-19`; `gw/users.ts:40,56` |
| 19 | Record sharing (403 / 404) | Detail screens turn every failure into "Failed to load ..." with a retry button. A record the user is not allowed to see looks like an outage. Lists being shorter per user is handled by default. | `lib/features/deals/deal_detail_screen.dart:52-53`; `lib/features/contacts/contact_detail_screen.dart:131-132`; `gw/deals.ts:72` |

## Auth and session handling

| # | Area | Finding | Evidence |
|---|---|---|---|
| 1 | Login | Sends `email, password, tenantSlug`, as the server requires. The server's error message, including the 429 `TOO_MANY_ATTEMPTS` text, is shown in a snackbar. No lockout timer or retry hint beyond that. | `lib/core/auth/auth_service.dart:30-34`; `lib/core/auth/auth_provider.dart:112-123`; `auth/routes/auth.routes.ts:58-64,400-402` |
| 2 | Refresh rotation | The new refresh token is saved after each refresh, so rotation is respected. A single `_isRefreshing` flag prevents a second refresh while one is in flight, so the client should not trip reuse detection by itself. | `lib/core/api/api_client.dart:30-43,60-71`; `auth/routes/auth.routes.ts:484-494` |
| 3 | Concurrent 401s | Requests that get a 401 while a refresh is in flight are not queued or retried; they fail. The dashboard fires six or seven calls at once, so after the access token expires one section loads and the rest show errors until pull-to-refresh. | `lib/core/api/api_client.dart:30,45`; `lib/features/dashboard/dashboard_screen.dart:39-52` |
| 4 | Refresh failure | Any failure of the refresh call, including a timeout or no signal, clears all tokens. A rep in poor coverage is silently logged out. | `lib/core/api/api_client.dart:73-78` |
| 5 | After tokens are cleared | The auth state is not updated, and the router only redirects on auth state. The app stays on the signed-in screens with every call failing until it is restarted. | `lib/core/api/api_client.dart:77`; `lib/app.dart:75-81`; `lib/core/auth/auth_provider.dart:34-47` |
| 6 | Logout | Posts to `AUTH_URL/auth/logout` (the auth service, port 4001 by default) instead of the gateway's `/auth/logout`. Errors are swallowed. If the auth service is not publicly reachable, refresh tokens are never revoked server-side. | `lib/core/auth/auth_service.dart:84-95`; `lib/core/api/endpoints.dart:14-17`; `gw/auth.ts:70` |
| 7 | Session restore | On start the app trusts the cached user JSON and never calls `/auth/me`. The user returned by refresh is ignored. Role changes or deactivation are not reflected until the next login. | `lib/core/auth/auth_provider.dart:34-47`; `lib/core/auth/auth_service.dart:98-106`; `lib/core/api/api_client.dart:66-70` |
| 8 | Register | In sandbox signup mode the server returns `verificationRequired` with no tokens; the app passes null into `saveTokens` and shows a generic error although the account was created. With Turnstile configured the server requires `turnstileToken`, which the app never sends (403). | `lib/core/auth/auth_service.dart:68-72`; `auth/routes/auth.routes.ts:134-140,232-239` |
| 9 | SSO | None. The server supports SAML / OIDC and Google OAuth. Users without a password cannot sign in on mobile. | `auth/sso.ts:1-15`; `auth/routes/internal.routes.ts:62`; `gw/auth.ts:75-78`; `auth/routes/auth.routes.ts:416` |
| 10 | Token storage | Tokens and user JSON are in `flutter_secure_storage` with encrypted shared preferences on Android. No biometric or app lock. | `lib/core/auth/token_storage.dart:5-7` |
| 11 | 403 / 429 outside login | No handling. Role-gated calls (see Broken #8) and rate limits surface as a generic failure or an empty list. `read_only` users see the same write buttons as reps. | `lib/core/api/api_client.dart:29-46` |
| 12 | Password flows | Forgot password is unreachable and change password has no server route (Broken #9, #10). | as cited there |

## Fabricated or placeholder data

| # | Screen | What is shown as if real | Evidence |
|---|---|---|---|
| 1 | Lead scoring | Five hardcoded people ("Sarah Chen, Acme Corp, 92 hot" and so on) whenever the API returns an empty list or any error. An empty list is a normal state on the server. | `lib/features/lead_scoring/lead_scoring_screen.dart:22-100,147,150` |
| 2 | Leads | Score and hot / warm / cold tier are computed from a hash of the record id, because the contacts API returns no `score`. The tier filter filters on that number. | `lib/features/leads/leads_screen.dart:36-46,93-94,165` |
| 3 | Territories | Demo territories and rules on empty result or error, and in practice always (Broken #21). The server also returns hardcoded rules from `GET /territories/rules`, and hardcoded territories if its query fails. | `lib/features/territories/territories_screen.dart:166,271,450-481`; `gw/territories.ts:31-37,152-162` |
| 4 | Anomalies | On any load error: demo alerts plus a hardcoded summary (1 critical, 1 high, 1 medium, 1 low). A failed scan shows "Scan completed (demo mode)". A failed status change still removes the alert from the list. | `lib/features/anomalies/anomalies_screen.dart:207-222,239,255-259` |
| 5 | Marketplace | Demo app catalogue on empty result or error. A failed install (for example 403 for a non-admin) marks the app installed and shows "installed (offline mode)". | `lib/features/marketplace/marketplace_screen.dart:134,262,265,318-329`; `gw/marketplace.ts:142` |
| 6 | AI review queue | Demo items when the queue is empty or the call fails; the error is suppressed. | `lib/features/review/review_queue_screen.dart:17,146,152-153` |
| 7 | Compliance | Demo controls, escrow, mirror destinations and retention policies, always (Broken #20). | `lib/features/compliance/compliance_screen.dart:44-91,156-181` |
| 8 | Import | The wizard uploads nothing. Progress is a timer and the result is fixed: 150 rows, 128 created, 14 updated, 5 skipped, 3 errors. The job list shows demo jobs when empty or on error. | `lib/features/import/import_screen.dart:104,161,165,230-262` |
| 9 | Insights | Falls back to built-in activity, engagement, pipeline and team figures on any error. The endpoints do not exist (Broken #1). | `lib/features/insights/insights_screen.dart:151-161` |
| 10 | Dashboard | When the forecast, stale-deal or team calls fail (two of them always do, Broken #12 and #13), the sections are derived from the first 200 deals and shown under the same headings. | `lib/features/dashboard/dashboard_screen.dart:147-177,389,409` |
| 11 | Notification settings | Six toggles that are never loaded from or saved to the server. The API has `GET` / `PATCH /notifications/preferences`. | `lib/features/settings/notifications_settings_screen.dart:12-22`; `gw/notifications.ts:89,122` |

## Missing for a field rep

Present on the API, with no mobile screen or call:

1. Lead conversion (`POST /leads/:id/convert`) and lead status (`new, working, nurturing, qualified, unqualified`); duplicate matching before convert (`/leads/:id/matches`).
2. Contact roles on an opportunity (`GET` / `PUT /deals/:id/contact-roles`), deal team and splits.
3. Editing a deal beyond its stage (value, close date, owner, company); linking a deal to a company or contact at creation.
4. Editing a contact or company; setting account status (`prospect, customer, churned, partner`).
5. Quote detail view, quote PDF, submit for approval, the approvals inbox (`/api/v1/approvals`), quote-to-deal sync.
6. Price books (`/api/v1/price-books`).
7. "My records" / team scope on lists (`?scope=mine|team`).
8. Global search (`/api/v1/search`) and the record timeline (`/api/v1/timeline/:entityType/:id`).
9. Email threads and send, and call logging through the outreach service (`/outreach/email/*`, `/outreach/calls`).
10. Meeting booking links.
11. Offline behaviour: no local cache, no queued writes, no connectivity check. Every screen needs a live connection.
12. Push notifications: no push package in `pubspec.yaml`; notifications are a pull-only list.

## Build and release readiness

1. **No platform projects.** `apps/mobile` has `lib/`, `pubspec.yaml`, `analysis_options.yaml` and `.vscode/` only in git. An untracked `pubspec.lock` and an ignored `.dart_tool/` appeared during this audit, created by other work on the machine, not by the audit. There is no `android/` or `ios/` folder, so no APK or IPA can be built until `flutter create` is run and signing is set up. `docs/mobile-perf-checklist.md` assumes `flutter build apk --release` works.
2. **Does not compile** (Broken #1).
3. **No tests.** `apps/mobile/test` does not exist.
4. **No CI.** `.github/workflows/ci.yml`, `codeql.yml` and `deploy.yml` contain no Flutter or Dart step; nothing analyzes or builds the app.
5. **API base URL.** Set at build time with `--dart-define=API_URL=...` and `AUTH_URL=...`. The defaults are `http://10.0.2.2:4000` and `:4001` (Android emulator loopback, cleartext). A release build without the defines points at the emulator host. The only place release values are written down is `.vscode/launch.json` (`https://api.nexcrm.com`, `https://auth.nexcrm.com`).
6. **`AUTH_URL` dependency.** Logout needs the auth service to be publicly reachable; everything else goes through the gateway.
7. **Sentry.** DSN comes from `--dart-define=SENTRY_DSN`, default empty.
8. **Router.** `GoRouter` is constructed inside `build` and rebuilt on every auth state change (`lib/app.dart:70-72`).

## Not verified

Nothing was run on a device or emulator (the analyzer result at the top was added afterwards). No request was sent to any service. All findings come from reading the Dart sources against the TypeScript and Python handlers.

`gc/companies.ts`, `gc/contacts.ts` and `gc/deals.ts` were being edited by other work while this audit ran (uncommitted list-query changes; the zod schemas and response mappers were not touched). Line numbers for those three files are from the working tree at the end of the audit and may be a few lines off against the last commit.

Specific things that need a running build to confirm:

- **Body-less POST / PATCH calls.** The Dio client sets `Content-Type: application/json` on every request. Fastify's default JSON parser rejects an empty body with that header, and the gateway registers no custom parser. If Dio sends the header without a body, these calls fail with 400: quote send and approve, notification mark read and mark all read, forecast compute, anomaly scan, merge cancel, review queue approve and reject.
- **Broken #21** relies on node-postgres returning `COUNT(*)` and `numeric` as strings by default; no type parser override was found in the gateway.
- **Activities list crash** (Works but wrong #10) depends on activities having a non-null sentiment in the data.
- **`GET /api/v1/ai/forecast`** on the dashboard: the route exists, but the ai-engine response shape was not compared with what the forecast card reads.
- Other compile errors beyond the nine undefined `Endpoints` members were not searched for; only an analyzer run can rule them out.
- UI layout, performance, and the many read-only widgets inside the larger screens were not reviewed beyond the fields they read from API responses.
