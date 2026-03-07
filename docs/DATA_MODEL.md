# NexCRM Data Model Reference

> Auto-generated from migrations `001`–`027`. See [BLUEPRINT.md](BLUEPRINT.md) for architecture context.

---

## 1. Overview

NexCRM uses **PostgreSQL** as its single database engine with three layers:

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Relational tables | PostgreSQL 16 | Multi-tenancy, auth, events, workflows, outreach, reporting |
| Property graph | Apache AGE (`nexcrm_graph`) | Contacts, companies, deals, relationships, buying groups |
| Vector embeddings | pgvector | Semantic search, RAG context, similarity matching |

All relational tables carry a `tenant_id` column for row-level isolation. Graph nodes store `tenant_id` as a property. Soft deletes use a nullable `deleted_at` column where applicable.

---

## 2. Relational Tables

### 2.1 Core / Multi-Tenancy

#### `tenants`
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, default `gen_random_uuid()` |
| name | TEXT | NOT NULL |
| slug | TEXT | NOT NULL, UNIQUE |
| domain | TEXT | |
| plan | TEXT | NOT NULL, default `'starter'`, CHECK `(starter\|growth\|enterprise)` |
| data_region | TEXT | NOT NULL, default `'us'`, CHECK `(us\|eu\|apac)` |
| settings | JSONB | NOT NULL, default `'{}'` |
| stripe_customer_id | TEXT | UNIQUE *(004)* |
| stripe_subscription_id | TEXT | UNIQUE *(004)* |
| stripe_subscription_status | TEXT | CHECK `(active\|past_due\|canceled\|unpaid\|trialing\|paused\|incomplete\|incomplete_expired)` *(004)* |
| subscription_period_end | TIMESTAMPTZ | *(004)* |
| default_currency | TEXT | NOT NULL, default `'USD'`, CHECK ISO 4217 *(005)* |
| locale | TEXT | NOT NULL, default `'en-US'` *(005)* |
| timezone | TEXT | NOT NULL, default `'UTC'` *(005)* |
| discount_approval_threshold | NUMERIC(5,2) | NOT NULL, default `10.00` *(008)* |
| quote_valid_days | INTEGER | NOT NULL, default `30` *(008)* |
| quote_send_method | TEXT | NOT NULL, default `'email'`, CHECK `(email\|link\|both)` *(008)* |
| parent_tenant_id | UUID | FK `tenants(id)` ON DELETE SET NULL *(022)* |
| created_at | TIMESTAMPTZ | NOT NULL, default `NOW()` |
| updated_at | TIMESTAMPTZ | NOT NULL, default `NOW()` |
| deleted_at | TIMESTAMPTZ | |

#### `users`
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| tenant_id | UUID | NOT NULL, FK `tenants(id)` CASCADE |
| email | TEXT | NOT NULL, UNIQUE with `(tenant_id, email)` |
| password_hash | TEXT | nullable (OAuth-only users) |
| first_name | TEXT | NOT NULL |
| last_name | TEXT | NOT NULL |
| role | TEXT | NOT NULL, default `'rep'`, CHECK `(super_admin\|admin\|manager\|rep\|read_only)` |
| avatar_url | TEXT | |
| manager_id | UUID | FK `users(id)` ON DELETE SET NULL *(008)* |
| can_quote | BOOLEAN | NOT NULL, default `false` *(008)* |
| country | TEXT | *(011)* |
| timezone | TEXT | *(011)* |
| language | TEXT | default `'en'` *(011)* |
| phone | TEXT | *(011)* |
| twilio_number | TEXT | *(011)* |
| last_login_at | TIMESTAMPTZ | |
| created_at | TIMESTAMPTZ | NOT NULL |
| updated_at | TIMESTAMPTZ | NOT NULL |
| deleted_at | TIMESTAMPTZ | |

### 2.2 Auth & Security

#### `oauth_tokens`
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| tenant_id | UUID | NOT NULL, FK `tenants(id)` CASCADE |
| user_id | UUID | NOT NULL, FK `users(id)` CASCADE |
| provider | TEXT | NOT NULL, CHECK `(google\|microsoft\|slack\|zoom)` |
| access_token | TEXT | NOT NULL (encrypted at app layer) |
| refresh_token | TEXT | |
| expires_at | TIMESTAMPTZ | |
| scopes | TEXT[] | NOT NULL, default `'{}'` |
| metadata | JSONB | |
| created_at / updated_at | TIMESTAMPTZ | |
| | | UNIQUE `(tenant_id, user_id, provider)` |

#### `refresh_tokens`
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| user_id | UUID | NOT NULL, FK `users(id)` CASCADE |
| token_hash | TEXT | NOT NULL, UNIQUE (SHA-256) |
| expires_at | TIMESTAMPTZ | NOT NULL |
| revoked_at | TIMESTAMPTZ | |
| created_at | TIMESTAMPTZ | NOT NULL |

#### `api_keys` *(013)*
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| tenant_id | UUID | NOT NULL, FK `tenants(id)` CASCADE |
| created_by | UUID | NOT NULL, FK `users(id)` CASCADE |
| name | TEXT | NOT NULL |
| key_hash | TEXT | NOT NULL, UNIQUE (SHA-256) |
| key_prefix | TEXT | NOT NULL (first 8 chars) |
| scopes | TEXT[] | NOT NULL, default `'{"crm:read"}'` |
| last_used_at | TIMESTAMPTZ | |
| expires_at | TIMESTAMPTZ | nullable (NULL = no expiry) |
| is_active | BOOLEAN | NOT NULL, default `true` |
| created_at | TIMESTAMPTZ | NOT NULL |

#### `password_reset_tokens` *(013)*
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| user_id | UUID | NOT NULL, FK `users(id)` CASCADE |
| token_hash | TEXT | NOT NULL, UNIQUE |
| expires_at | TIMESTAMPTZ | NOT NULL, default `NOW() + 1 hour` |
| used_at | TIMESTAMPTZ | |
| created_at | TIMESTAMPTZ | NOT NULL |

### 2.3 Permissions *(015)*

#### `record_permissions`
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| tenant_id | UUID | NOT NULL, FK `tenants(id)` CASCADE |
| entity_type | TEXT | NOT NULL |
| entity_id | UUID | NOT NULL |
| grantee_type | TEXT | NOT NULL, CHECK `(user\|role\|team)` |
| grantee_id | TEXT | NOT NULL |
| can_read | BOOLEAN | NOT NULL, default `true` |
| can_write | BOOLEAN | NOT NULL, default `false` |
| can_delete | BOOLEAN | NOT NULL, default `false` |
| granted_by | UUID | FK `users(id)` |
| created_at | TIMESTAMPTZ | NOT NULL |

#### `field_permissions`
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| tenant_id | UUID | NOT NULL, FK `tenants(id)` CASCADE |
| entity_type | TEXT | NOT NULL |
| field_name | TEXT | NOT NULL |
| role | TEXT | NOT NULL, CHECK `(super_admin\|admin\|manager\|rep\|read_only)` |
| access_level | TEXT | NOT NULL, default `'read_write'`, CHECK `(hidden\|read_only\|read_write)` |
| created_at / updated_at | TIMESTAMPTZ | |
| | | UNIQUE `(tenant_id, entity_type, field_name, role)` |

#### `record_permission_defaults`
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| tenant_id | UUID | NOT NULL, FK `tenants(id)` CASCADE |
| entity_type | TEXT | NOT NULL |
| owner_access | TEXT | NOT NULL, default `'read_write_delete'` |
| team_access | TEXT | NOT NULL, default `'read'` |
| org_access | TEXT | NOT NULL, default `'none'` |
| created_at / updated_at | TIMESTAMPTZ | |
| | | UNIQUE `(tenant_id, entity_type)` |

### 2.4 Activities & Tasks

#### `activities` *(006)* — partitioned by `occurred_at` (monthly)
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL (part of composite PK) |
| tenant_id | TEXT | NOT NULL |
| type | TEXT | NOT NULL, CHECK `(email\|call\|meeting\|note\|document)` |
| direction | TEXT | CHECK `(inbound\|outbound\|internal)` |
| subject | TEXT | |
| summary | TEXT | |
| sentiment | NUMERIC(4,3) | CHECK `BETWEEN -1 AND 1` |
| duration_seconds | INTEGER | CHECK `> 0 AND <= 86400` |
| occurred_at | TIMESTAMPTZ | NOT NULL (partition key, part of PK) |
| source | TEXT | NOT NULL, default `'user'` |
| external_id | TEXT | |
| deal_id | UUID | |
| company_id | UUID | |
| storage_key | TEXT | |
| created_by | UUID | FK `users(id)` *(011)* |
| related_to | TEXT | *(011)* |
| custom_fields | JSONB | NOT NULL, default `'{}'` *(014)* |
| created_at / updated_at | TIMESTAMPTZ | |
| deleted_at | TIMESTAMPTZ | |

#### `activity_participants` *(006)* — partitioned by `occurred_at` (monthly)
| Column | Type | Constraints |
|--------|------|-------------|
| activity_id | UUID | NOT NULL |
| occurred_at | TIMESTAMPTZ | NOT NULL (partition key) |
| contact_id | UUID | |
| first_name | TEXT | |
| last_name | TEXT | |
| email | TEXT | NOT NULL |
| role | TEXT | NOT NULL, default `'participant'` |
| | | PK `(activity_id, occurred_at, email)` |

#### `tasks` *(020)*
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| tenant_id | UUID | NOT NULL, FK `tenants(id)` CASCADE |
| title | TEXT | NOT NULL |
| description | TEXT | |
| due_date | TIMESTAMPTZ | |
| priority | TEXT | NOT NULL, default `'medium'`, CHECK `(low\|medium\|high)` |
| status | TEXT | NOT NULL, default `'open'`, CHECK `(pending\|open\|in_progress\|done)` |
| assignee_id | UUID | FK `users(id)` |
| related_to_type | TEXT | CHECK `(deal\|contact\|company)` |
| related_to_id | UUID | |
| source | TEXT | |
| metadata | JSONB | default `'{}'` |
| custom_fields | JSONB | NOT NULL, default `'{}'` *(014)* |
| created_at / updated_at | TIMESTAMPTZ | |
| deleted_at | TIMESTAMPTZ | |

### 2.5 Outreach / Sales Engagement *(007)*

#### `email_threads`
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| tenant_id | UUID | NOT NULL, FK `tenants(id)` CASCADE |
| contact_id | UUID | |
| deal_id | UUID | |
| subject | TEXT | NOT NULL, default `'(no subject)'` |
| snippet | TEXT | |
| last_message_at | TIMESTAMPTZ | NOT NULL |
| message_count | INTEGER | NOT NULL, default `0` |
| unread_count | INTEGER | NOT NULL, default `0` |
| participants | JSONB | NOT NULL, default `'[]'` |
| status | TEXT | NOT NULL, default `'open'`, CHECK `(open\|archived\|spam)` |
| created_at / updated_at | TIMESTAMPTZ | |
| deleted_at | TIMESTAMPTZ | |

#### `email_messages`
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| tenant_id | UUID | NOT NULL, FK `tenants(id)` CASCADE |
| thread_id | UUID | NOT NULL, FK `email_threads(id)` CASCADE |
| user_id | UUID | FK `users(id)` |
| direction | TEXT | NOT NULL, CHECK `(inbound\|outbound)` |
| from_email | TEXT | NOT NULL |
| from_name | TEXT | |
| to_recipients | JSONB | NOT NULL, default `'[]'` |
| cc_recipients | JSONB | NOT NULL, default `'[]'` |
| bcc_recipients | JSONB | NOT NULL, default `'[]'` |
| subject | TEXT | NOT NULL |
| body_text | TEXT | NOT NULL |
| provider | TEXT | NOT NULL, CHECK `(gmail\|outlook)` |
| provider_message_id | TEXT | |
| in_reply_to | TEXT | |
| send_status | TEXT | NOT NULL, default `'draft'`, CHECK `(draft\|scheduled\|sending\|sent\|failed\|bounced)` |
| scheduled_at | TIMESTAMPTZ | |
| sent_at | TIMESTAMPTZ | |
| error_message | TEXT | |
| sequence_step_execution_id | UUID | FK `sequence_step_executions(id)` |
| created_at / updated_at | TIMESTAMPTZ | |
| deleted_at | TIMESTAMPTZ | |

#### `sequences`
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| tenant_id | UUID | NOT NULL, FK `tenants(id)` CASCADE |
| name | TEXT | NOT NULL |
| description | TEXT | |
| owner_id | UUID | FK `users(id)` |
| status | TEXT | NOT NULL, default `'draft'`, CHECK `(draft\|active\|paused\|archived)` |
| goal | TEXT | |
| active_enrollments | INTEGER | NOT NULL, default `0` |
| completed_enrollments | INTEGER | NOT NULL, default `0` |
| settings | JSONB | NOT NULL, default `'{}'` |
| created_at / updated_at | TIMESTAMPTZ | |
| deleted_at | TIMESTAMPTZ | |

#### `sequence_steps`
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| tenant_id | UUID | NOT NULL, FK `tenants(id)` CASCADE |
| sequence_id | UUID | NOT NULL, FK `sequences(id)` CASCADE |
| step_number | INTEGER | NOT NULL, CHECK `>= 1`, UNIQUE with `(sequence_id, step_number)` |
| type | TEXT | NOT NULL, CHECK `(email\|call\|linkedin_task)` |
| day_offset | INTEGER | NOT NULL, default `0` |
| time_of_day | TIME | NOT NULL, default `'09:00'` |
| subject_template | TEXT | |
| body_template | TEXT | supports `{{first_name}}` etc. |
| task_note | TEXT | |
| ai_suggestions | BOOLEAN | NOT NULL, default `true` |
| settings | JSONB | NOT NULL, default `'{}'` |
| created_at / updated_at | TIMESTAMPTZ | |

#### `sequence_enrollments`
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| tenant_id | UUID | NOT NULL, FK `tenants(id)` CASCADE |
| sequence_id | UUID | NOT NULL, FK `sequences(id)` |
| contact_id | UUID | |
| contact_email | TEXT | NOT NULL |
| contact_first_name | TEXT | NOT NULL |
| contact_last_name | TEXT | NOT NULL |
| contact_timezone | TEXT | NOT NULL, default `'UTC'` |
| enrolled_by | UUID | FK `users(id)` |
| status | TEXT | NOT NULL, default `'active'`, CHECK `(active\|paused\|completed\|replied\|opted_out\|bounced\|error)` |
| current_step | INTEGER | NOT NULL, default `1` |
| enrolled_at | TIMESTAMPTZ | NOT NULL |
| finished_at | TIMESTAMPTZ | |
| pause_reason | TEXT | |
| created_at / updated_at | TIMESTAMPTZ | |
| | | UNIQUE `(sequence_id, contact_email)` |

#### `sequence_step_executions`
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| tenant_id | UUID | NOT NULL, FK `tenants(id)` CASCADE |
| enrollment_id | UUID | NOT NULL, FK `sequence_enrollments(id)` CASCADE |
| step_id | UUID | NOT NULL, FK `sequence_steps(id)` |
| step_number | INTEGER | NOT NULL |
| type | TEXT | NOT NULL, CHECK `(email\|call\|linkedin_task)` |
| status | TEXT | NOT NULL, default `'pending'`, CHECK `(pending\|scheduled\|sent\|delivered\|failed\|skipped\|replied\|bounced)` |
| scheduled_at | TIMESTAMPTZ | |
| executed_at | TIMESTAMPTZ | |
| opens | INTEGER | NOT NULL, default `0` |
| clicks | INTEGER | NOT NULL, default `0` |
| replied_at | TIMESTAMPTZ | |
| bounced_at | TIMESTAMPTZ | |
| error_message | TEXT | |
| created_at / updated_at | TIMESTAMPTZ | |

#### `phone_calls`
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| tenant_id | UUID | NOT NULL, FK `tenants(id)` CASCADE |
| user_id | UUID | FK `users(id)` |
| contact_id | UUID | |
| contact_email | TEXT | |
| contact_name | TEXT | |
| direction | TEXT | NOT NULL, CHECK `(inbound\|outbound)` |
| to_number | TEXT | NOT NULL |
| from_number | TEXT | NOT NULL |
| provider | TEXT | NOT NULL, default `'twilio'`, CHECK `(twilio\|nooks\|orum\|manual)` |
| provider_call_sid | TEXT | |
| status | TEXT | NOT NULL, default `'initiated'`, CHECK `(initiated\|ringing\|in-progress\|completed\|failed\|no-answer\|busy\|canceled)` |
| disposition | TEXT | CHECK `(connected\|voicemail\|no-answer\|busy\|bad-number\|do-not-call)` |
| duration_seconds | INTEGER | |
| recording_s3_key | TEXT | |
| recording_consent_confirmed | BOOLEAN | NOT NULL, default `false` |
| notes | TEXT | |
| sequence_step_execution_id | UUID | FK `sequence_step_executions(id)` |
| started_at | TIMESTAMPTZ | NOT NULL |
| ended_at | TIMESTAMPTZ | |
| created_at / updated_at | TIMESTAMPTZ | |

#### `dialer_configs`
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| tenant_id | UUID | NOT NULL, UNIQUE, FK `tenants(id)` CASCADE |
| native_enabled | BOOLEAN | NOT NULL, default `false` |
| native_credentials_enc | TEXT | AES-256-GCM ciphertext |
| iframe_configs | JSONB | NOT NULL, default `'[]'` |
| active_dialer | TEXT | NOT NULL, default `'native'`, CHECK `(native\|iframe)` |
| active_iframe_id | TEXT | |
| created_at / updated_at | TIMESTAMPTZ | |

#### `opt_out_records`
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| tenant_id | UUID | NOT NULL, FK `tenants(id)` CASCADE |
| contact_email | TEXT | NOT NULL |
| contact_id | UUID | |
| channel | TEXT | NOT NULL, default `'email'`, CHECK `(email\|phone\|all)` |
| reason | TEXT | NOT NULL, default `'unsubscribe'`, CHECK `(unsubscribe\|gdpr_request\|bounce\|manual\|complaint)` |
| opted_out_by | UUID | FK `users(id)` |
| notes | TEXT | |
| opted_out_at | TIMESTAMPTZ | NOT NULL |
| created_at | TIMESTAMPTZ | NOT NULL |
| | | UNIQUE `(tenant_id, contact_email, channel)` |

#### `outreach_usage`
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| tenant_id | UUID | NOT NULL, FK `tenants(id)` CASCADE |
| month | TEXT | NOT NULL (format `YYYY-MM`) |
| emails_sent | INTEGER | NOT NULL, default `0` |
| calls_made | INTEGER | NOT NULL, default `0` |
| | | UNIQUE `(tenant_id, month)` |

### 2.6 Quotes & Products *(008–009)*

#### `products`
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| tenant_id | UUID | NOT NULL, FK `tenants(id)` CASCADE |
| sku | TEXT | |
| name | TEXT | NOT NULL |
| description | TEXT | |
| unit_price | NUMERIC(14,2) | NOT NULL, default `0` |
| currency | TEXT | NOT NULL, default `'USD'` |
| billing_cycle | TEXT | NOT NULL, default `'one_time'`, CHECK `(one_time\|monthly\|annual)` |
| active | BOOLEAN | NOT NULL, default `true` |
| created_at / updated_at | TIMESTAMPTZ | |

#### `quotes`
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| tenant_id | UUID | NOT NULL, FK `tenants(id)` CASCADE |
| quote_number | TEXT | NOT NULL (e.g. `Q-2026-0001`) |
| deal_id | UUID | graph node ref |
| contact_id | UUID | graph node ref |
| company_id | UUID | graph node ref |
| company_name | TEXT | denormalized *(009)* |
| contact_name | TEXT | denormalized *(009)* |
| created_by | UUID | NOT NULL, FK `users(id)` |
| assigned_to | UUID | FK `users(id)` |
| status | TEXT | NOT NULL, default `'draft'`, CHECK `(draft\|pending_approval\|sent\|viewed\|accepted\|rejected\|expired)` |
| approval_required | BOOLEAN | NOT NULL, default `false` |
| approved_by | UUID | FK `users(id)` |
| approved_at | TIMESTAMPTZ | |
| subtotal | NUMERIC(14,2) | NOT NULL, default `0` |
| discount_type | TEXT | NOT NULL, default `'none'`, CHECK `(none\|percent\|fixed)` |
| discount_value | NUMERIC(14,2) | NOT NULL, default `0` |
| tax_rate | NUMERIC(5,2) | NOT NULL, default `0` |
| total | NUMERIC(14,2) | NOT NULL, default `0` |
| currency | TEXT | NOT NULL, default `'USD'` |
| title | TEXT | NOT NULL |
| notes | TEXT | |
| terms | TEXT | |
| valid_until | DATE | |
| related_to | TEXT | *(011)* |
| sent_at / viewed_at / accepted_at / rejected_at | TIMESTAMPTZ | |
| pdf_key | TEXT | |
| created_at / updated_at | TIMESTAMPTZ | |

#### `quote_items`
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| quote_id | UUID | NOT NULL, FK `quotes(id)` CASCADE |
| product_id | UUID | FK `products(id)` ON DELETE SET NULL |
| product_name | TEXT | NOT NULL (snapshot) |
| description | TEXT | |
| quantity | NUMERIC(10,3) | NOT NULL, default `1` |
| unit_price | NUMERIC(14,2) | NOT NULL |
| discount_pct | NUMERIC(5,2) | NOT NULL, default `0` |
| line_total | NUMERIC(14,2) | NOT NULL |
| sort_order | INTEGER | NOT NULL, default `0` |
| created_at | TIMESTAMPTZ | NOT NULL |

### 2.7 Reality Score *(003)*

#### `deal_signals`
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| tenant_id | UUID | NOT NULL |
| deal_uuid | UUID | NOT NULL (matches Deal graph node `id` property) |
| signal_type | TEXT | NOT NULL, CHECK `(pricing_mentioned\|quote_requested\|quote_sent\|quote_opened\|contract_sent\|contract_opened)` |
| occurred_at | TIMESTAMPTZ | NOT NULL |
| source | TEXT | NOT NULL, default `'user'` |
| metadata | JSONB | NOT NULL, default `'{}'` |
| created_at | TIMESTAMPTZ | NOT NULL |

#### `deal_score_snapshots`
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| tenant_id | UUID | NOT NULL |
| deal_uuid | UUID | NOT NULL |
| score | SMALLINT | NOT NULL, CHECK `BETWEEN 0 AND 100` |
| pillar_scores | JSONB | NOT NULL (`{momentum, commercial, buying_group, structural}`) |
| archetype | TEXT | NOT NULL, default `'simple'` |
| computed_at | TIMESTAMPTZ | NOT NULL |

### 2.8 Review Queue *(001)*

#### `review_queue`
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| tenant_id | UUID | NOT NULL, FK `tenants(id)` CASCADE |
| extraction_id | TEXT | NOT NULL |
| status | TEXT | NOT NULL, default `'pending'`, CHECK `(pending\|approved\|rejected\|auto_approved)` |
| confidence | NUMERIC(4,3) | NOT NULL, CHECK `BETWEEN 0 AND 1` |
| summary | TEXT | NOT NULL |
| proposed_changes | JSONB | NOT NULL |
| evidence | TEXT | |
| reviewed_by | UUID | FK `users(id)` |
| reviewed_at | TIMESTAMPTZ | |
| rejection_reason | TEXT | |
| embedding | VECTOR(1536) | *(012)* |
| created_at / updated_at | TIMESTAMPTZ | |

### 2.9 Integrations & Ingestion

#### `integrations` *(001)*
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| tenant_id | UUID | NOT NULL, FK `tenants(id)` CASCADE |
| user_id | UUID | NOT NULL, FK `users(id)` CASCADE |
| provider | TEXT | NOT NULL |
| status | TEXT | NOT NULL, default `'active'`, CHECK `(active\|paused\|error\|disconnected)` |
| last_synced_at | TIMESTAMPTZ | |
| error_message | TEXT | |
| config | JSONB | NOT NULL, default `'{}'` |
| created_at / updated_at | TIMESTAMPTZ | |

#### `ingested_messages` *(002, 026)*
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| tenant_id | UUID | NOT NULL, FK `tenants(id)` CASCADE |
| source | TEXT | NOT NULL (`gmail`, `outlook`, etc.) |
| source_event_id | TEXT | NOT NULL |
| entity_id | UUID | FK to `activities.id` *(026)* |
| created_at | TIMESTAMPTZ | NOT NULL |
| | | UNIQUE `(tenant_id, source, source_event_id)` |

### 2.10 Entity Resolution Indexes *(002, 027)*

#### `person_email_index`
| Column | Type | Constraints |
|--------|------|-------------|
| tenant_id | UUID | NOT NULL, FK `tenants(id)` CASCADE |
| email | TEXT | NOT NULL |
| node_id | TEXT | NOT NULL (AGE graph Person node ID) |
| created_at | TIMESTAMPTZ | NOT NULL |
| | | UNIQUE `(tenant_id, email)` |

#### `company_domain_index`
| Column | Type | Constraints |
|--------|------|-------------|
| tenant_id | UUID | NOT NULL, FK `tenants(id)` CASCADE |
| domain | TEXT | NOT NULL |
| node_id | TEXT | NOT NULL (AGE graph Company node ID) |
| created_at | TIMESTAMPTZ | NOT NULL |
| | | UNIQUE `(tenant_id, domain)` |

### 2.11 Workflows *(001)*

#### `workflow_definitions`
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| tenant_id | UUID | NOT NULL, FK `tenants(id)` CASCADE |
| name | TEXT | NOT NULL |
| description | TEXT | |
| trigger | JSONB | NOT NULL |
| conditions | JSONB | NOT NULL, default `'[]'` |
| actions | JSONB | NOT NULL, default `'[]'` |
| is_active | BOOLEAN | NOT NULL, default `true` |
| version | INTEGER | NOT NULL, default `1` |
| environment | TEXT | NOT NULL, default `'production'`, CHECK `(dev\|staging\|production)` |
| created_by | UUID | FK `users(id)` |
| created_at / updated_at | TIMESTAMPTZ | |

#### `workflow_runs`
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| tenant_id | UUID | NOT NULL |
| workflow_id | UUID | NOT NULL, FK `workflow_definitions(id)` |
| trigger_event | JSONB | NOT NULL |
| status | TEXT | NOT NULL, default `'running'`, CHECK `(running\|completed\|failed\|cancelled)` |
| steps_log | JSONB | NOT NULL, default `'[]'` |
| started_at | TIMESTAMPTZ | NOT NULL |
| completed_at | TIMESTAMPTZ | |
| error_message | TEXT | |

#### `automation_configs` *(019)*
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| tenant_id | UUID | NOT NULL, FK `tenants(id)` CASCADE |
| automation_key | TEXT | NOT NULL |
| is_enabled | BOOLEAN | NOT NULL, default `true` |
| config | JSONB | NOT NULL, default `'{}'` |
| created_at / updated_at | TIMESTAMPTZ | |
| | | UNIQUE `(tenant_id, automation_key)` |

### 2.12 Reporting *(010, 025)*

#### `report_datasets`
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| tenant_id | UUID | NOT NULL, FK `tenants(id)` CASCADE |
| created_by | UUID | NOT NULL, FK `users(id)` |
| name | TEXT | NOT NULL |
| description | TEXT | |
| version | INT | NOT NULL, default `1` |
| spec | JSONB | NOT NULL |
| is_published | BOOLEAN | NOT NULL, default `false` |
| created_at / updated_at | TIMESTAMPTZ | |

#### `reports`
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| tenant_id | UUID | NOT NULL, FK `tenants(id)` CASCADE |
| created_by | UUID | NOT NULL, FK `users(id)` |
| dataset_id | UUID | FK `report_datasets(id)` ON DELETE SET NULL |
| name | TEXT | NOT NULL |
| description | TEXT | |
| spec | JSONB | NOT NULL |
| category | TEXT | NOT NULL, default `'standard'`, CHECK `(standard\|admin)` *(025)* |
| created_at / updated_at | TIMESTAMPTZ | |

#### `report_snapshots`
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| report_id | UUID | NOT NULL, FK `reports(id)` CASCADE |
| tenant_id | UUID | NOT NULL |
| taken_at | TIMESTAMPTZ | NOT NULL |
| row_count | INT | |
| data | JSONB | NOT NULL |

#### `report_subscriptions`
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| report_id | UUID | NOT NULL, FK `reports(id)` CASCADE |
| tenant_id | UUID | NOT NULL |
| user_id | UUID | NOT NULL, FK `users(id)` CASCADE |
| schedule | TEXT | NOT NULL |
| channels | JSONB | NOT NULL, default `'["email"]'` |
| threshold | JSONB | |
| is_active | BOOLEAN | NOT NULL, default `true` |
| created_at | TIMESTAMPTZ | NOT NULL |
| | | UNIQUE `(report_id, user_id)` |

#### `feature_usage_log` *(025)*
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| tenant_id | UUID | NOT NULL, FK `tenants(id)` CASCADE |
| user_id | UUID | NOT NULL, FK `users(id)` CASCADE |
| feature | TEXT | NOT NULL |
| action | TEXT | NOT NULL, default `'use'` |
| metadata | JSONB | NOT NULL, default `'{}'` |
| created_at | TIMESTAMPTZ | NOT NULL |

### 2.13 Slack Integration *(016)*

#### `slack_workspaces`
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| tenant_id | UUID | NOT NULL, FK `tenants(id)` CASCADE |
| team_id | TEXT | NOT NULL |
| team_name | TEXT | NOT NULL |
| bot_token_enc | TEXT | NOT NULL (encrypted) |
| bot_user_id | TEXT | NOT NULL |
| installed_by | UUID | FK `users(id)` |
| is_active | BOOLEAN | NOT NULL, default `true` |
| created_at / updated_at | TIMESTAMPTZ | |
| | | UNIQUE `(tenant_id, team_id)` |

#### `slack_user_mappings`
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| tenant_id | UUID | NOT NULL, FK `tenants(id)` CASCADE |
| user_id | UUID | NOT NULL, FK `users(id)` CASCADE |
| slack_user_id | TEXT | NOT NULL |
| slack_email | TEXT | |
| mapped_at | TIMESTAMPTZ | NOT NULL |
| | | UNIQUE `(tenant_id, user_id)` |

#### `slack_notifications`
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| tenant_id | UUID | NOT NULL, FK `tenants(id)` CASCADE |
| user_id | UUID | NOT NULL, FK `users(id)` |
| channel_id | TEXT | |
| message_ts | TEXT | |
| notification_type | TEXT | NOT NULL |
| entity_type | TEXT | |
| entity_id | UUID | |
| payload | JSONB | NOT NULL, default `'{}'` |
| status | TEXT | NOT NULL, default `'sent'`, CHECK `(sent\|actioned\|escalated\|expired\|failed)` |
| actioned_at | TIMESTAMPTZ | |
| escalated_at | TIMESTAMPTZ | |
| created_at | TIMESTAMPTZ | NOT NULL |

### 2.14 Bulk Operations *(017)*

#### `import_jobs`
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| tenant_id | UUID | NOT NULL, FK `tenants(id)` CASCADE |
| user_id | UUID | NOT NULL, FK `users(id)` |
| entity_type | TEXT | NOT NULL |
| file_name | TEXT | NOT NULL |
| file_format | TEXT | NOT NULL, CHECK `(csv\|xlsx\|json)` |
| column_mapping | JSONB | |
| status | TEXT | NOT NULL, default `'pending'`, CHECK `(pending\|mapping\|processing\|completed\|failed\|cancelled)` |
| total_rows | INT | |
| processed_rows | INT | default `0` |
| created_rows | INT | default `0` |
| updated_rows | INT | default `0` |
| skipped_rows | INT | default `0` |
| error_rows | INT | default `0` |
| errors | JSONB | default `'[]'` |
| dedup_field | TEXT | default `'email'` |
| storage_key | TEXT | |
| created_at / updated_at | TIMESTAMPTZ | |
| completed_at | TIMESTAMPTZ | |

### 2.15 AI Features *(018)*

#### `enrichment_jobs`
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| tenant_id | UUID | NOT NULL, FK `tenants(id)` CASCADE |
| entity_type | TEXT | NOT NULL |
| entity_id | UUID | NOT NULL |
| provider | TEXT | NOT NULL, default `'internal'` |
| status | TEXT | NOT NULL, default `'pending'`, CHECK `(pending\|processing\|completed\|failed\|skipped)` |
| input_data | JSONB | default `'{}'` |
| result_data | JSONB | default `'{}'` |
| confidence | NUMERIC(4,3) | |
| created_at | TIMESTAMPTZ | NOT NULL |
| completed_at | TIMESTAMPTZ | |

#### `ai_forecast_snapshots`
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| tenant_id | UUID | NOT NULL, FK `tenants(id)` CASCADE |
| period | TEXT | NOT NULL |
| pipeline_data | JSONB | NOT NULL |
| forecast_data | JSONB | NOT NULL |
| created_at | TIMESTAMPTZ | NOT NULL |

#### `meeting_summaries`
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| tenant_id | UUID | NOT NULL, FK `tenants(id)` CASCADE |
| activity_id | UUID | |
| source | TEXT | NOT NULL, default `'zoom'` |
| transcript | TEXT | |
| summary | TEXT | |
| action_items | JSONB | default `'[]'` |
| participants | JSONB | default `'[]'` |
| sentiment | TEXT | |
| status | TEXT | NOT NULL, default `'pending'`, CHECK `(pending\|processing\|completed\|failed)` |
| created_at | TIMESTAMPTZ | NOT NULL |
| completed_at | TIMESTAMPTZ | |

### 2.16 Custom Objects *(014)*

#### `custom_object_definitions`
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| tenant_id | UUID | NOT NULL, FK `tenants(id)` CASCADE |
| object_key | TEXT | NOT NULL, UNIQUE with `(tenant_id, object_key)` |
| object_label | TEXT | NOT NULL |
| object_label_plural | TEXT | NOT NULL |
| icon | TEXT | default `'box'` |
| description | TEXT | |
| is_active | BOOLEAN | NOT NULL, default `true` |
| created_by | UUID | FK `users(id)` |
| created_at / updated_at | TIMESTAMPTZ | |

#### `custom_field_definitions`
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| tenant_id | UUID | NOT NULL, FK `tenants(id)` CASCADE |
| entity_type | TEXT | NOT NULL, CHECK `(contact\|company\|deal\|activity\|task\|custom_object)` |
| custom_object_id | UUID | |
| field_key | TEXT | NOT NULL |
| field_label | TEXT | NOT NULL |
| field_type | TEXT | NOT NULL, CHECK `(text\|number\|date\|datetime\|boolean\|enum\|multi_enum\|url\|email\|phone\|currency\|lookup\|formula)` |
| field_options | JSONB | NOT NULL, default `'{}'` |
| validations | JSONB | NOT NULL, default `'{}'` |
| default_value | TEXT | |
| sort_order | INT | NOT NULL, default `0` |
| is_required | BOOLEAN | NOT NULL, default `false` |
| is_active | BOOLEAN | NOT NULL, default `true` |
| created_by | UUID | FK `users(id)` |
| created_at / updated_at | TIMESTAMPTZ | |
| | | UNIQUE `(tenant_id, entity_type, custom_object_id, field_key)` |

#### `custom_object_associations`
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| tenant_id | UUID | NOT NULL, FK `tenants(id)` CASCADE |
| custom_object_id | UUID | NOT NULL, FK `custom_object_definitions(id)` CASCADE |
| target_entity_type | TEXT | NOT NULL |
| relationship_type | TEXT | NOT NULL, default `'many_to_one'`, CHECK `(one_to_one\|one_to_many\|many_to_one\|many_to_many)` |
| created_at | TIMESTAMPTZ | NOT NULL |

#### `custom_object_records`
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| tenant_id | UUID | NOT NULL, FK `tenants(id)` CASCADE |
| object_id | UUID | NOT NULL, FK `custom_object_definitions(id)` CASCADE |
| data | JSONB | NOT NULL, default `'{}'` (GIN indexed) |
| owner_id | UUID | FK `users(id)` |
| created_by | UUID | FK `users(id)` |
| created_at / updated_at | TIMESTAMPTZ | |
| deleted_at | TIMESTAMPTZ | |

#### `custom_object_links`
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| tenant_id | UUID | NOT NULL |
| association_id | UUID | NOT NULL, FK `custom_object_associations(id)` CASCADE |
| record_id | UUID | NOT NULL, FK `custom_object_records(id)` CASCADE |
| linked_entity_type | TEXT | NOT NULL |
| linked_entity_id | UUID | NOT NULL |
| created_at | TIMESTAMPTZ | NOT NULL |

### 2.17 Webhooks *(013)*

#### `outbound_webhooks`
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| tenant_id | UUID | NOT NULL, FK `tenants(id)` CASCADE |
| created_by | UUID | NOT NULL, FK `users(id)` CASCADE |
| name | TEXT | NOT NULL |
| url | TEXT | NOT NULL |
| secret | TEXT | NOT NULL (HMAC-SHA256 signing secret, encrypted) |
| event_types | TEXT[] | NOT NULL |
| is_active | BOOLEAN | NOT NULL, default `true` |
| created_at / updated_at | TIMESTAMPTZ | |

#### `outbound_webhook_deliveries`
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| webhook_id | UUID | NOT NULL, FK `outbound_webhooks(id)` CASCADE |
| tenant_id | UUID | NOT NULL |
| event_type | TEXT | NOT NULL |
| payload | JSONB | NOT NULL |
| attempt_count | INT | NOT NULL, default `0` |
| next_attempt_at | TIMESTAMPTZ | |
| status | TEXT | NOT NULL, default `'pending'`, CHECK `(pending\|delivered\|failed\|cancelled)` |
| last_response_status | INT | |
| last_response_body | TEXT | |
| last_error | TEXT | |
| created_at | TIMESTAMPTZ | NOT NULL |
| delivered_at | TIMESTAMPTZ | |

### 2.18 Workspace Management *(022–024)*

#### `workspace_merges` *(023)*
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| source_id | UUID | NOT NULL, FK `tenants(id)` |
| target_id | UUID | NOT NULL, FK `tenants(id)` |
| initiated_by | UUID | NOT NULL, FK `users(id)` |
| status | TEXT | NOT NULL, default `'pending'`, CHECK `(pending\|previewing\|approved\|in_progress\|completed\|failed\|cancelled)` |
| conflict_data | JSONB | NOT NULL, default `'{}'` |
| resolutions | JSONB | NOT NULL, default `'{}'` |
| summary | JSONB | |
| error_message | TEXT | |
| created_at | TIMESTAMPTZ | NOT NULL |
| completed_at | TIMESTAMPTZ | |

#### `workspace_usage_stats` *(024)*
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| tenant_id | UUID | NOT NULL, FK `tenants(id)` CASCADE |
| period | TEXT | NOT NULL (`YYYY-MM`) |
| api_calls | INTEGER | NOT NULL, default `0` |
| ai_events | INTEGER | NOT NULL, default `0` |
| ai_tokens | BIGINT | NOT NULL, default `0` |
| emails_sent | INTEGER | NOT NULL, default `0` |
| calls_made | INTEGER | NOT NULL, default `0` |
| storage_bytes | BIGINT | NOT NULL, default `0` |
| created_at / updated_at | TIMESTAMPTZ | |
| | | UNIQUE `(tenant_id, period)` |

### 2.19 Audit Log *(001)* — partitioned by `created_at` (quarterly)

#### `audit_log`
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | NOT NULL (part of composite PK) |
| tenant_id | UUID | NOT NULL |
| user_id | UUID | |
| action | TEXT | NOT NULL (e.g. `contact.updated`) |
| entity_type | TEXT | NOT NULL |
| entity_id | TEXT | NOT NULL |
| before_state | JSONB | |
| after_state | JSONB | |
| ip_address | INET | |
| user_agent | TEXT | |
| created_at | TIMESTAMPTZ | NOT NULL (partition key, part of PK) |

---

## 3. Graph Schema (Apache AGE)

The graph is stored in an AGE graph named `nexcrm_graph`. Contacts, companies, and deals are **not** relational tables -- they are graph nodes with schema-free properties. New properties can be added without a migration.

### Node Labels

| Label | Key Properties |
|-------|---------------|
| `Person` | `id` (UUID), `tenant_id`, `email`, `first_name`, `last_name`, `role`, `seniority`, `influence_score`, `phone`, `title`, `linkedin_url` |
| `Company` | `id` (UUID), `tenant_id`, `domain`, `name`, `industry`, `headcount`, `arr`, `tier`, `website` |
| `Deal` | `id` (UUID), `tenant_id`, `name`, `stage`, `value`, `currency`, `close_date`, `reality_score`, `pipeline`, `owner_id`, `archetype`, `declared_probability`, `is_expansion` |
| `BuyingGroup` | `id`, `tenant_id`, `deal_id`, `composition_confidence` |
| `Activity` | `id`, `tenant_id`, `type`, `timestamp`, `sentiment`, `summary` |
| `Signal` | `id`, `tenant_id`, `type`, `score`, `source`, `timestamp` |
| `Project` | `id`, `tenant_id`, `status`, `owner`, `timeline` |
| `Task` | `id`, `tenant_id`, `due_date`, `assignee`, `status` |
| `Tenant` | `id`, `plan`, `settings`, `data_region` |

### Edge Types (Relationships)

| Label | Direction | Key Properties |
|-------|-----------|---------------|
| `WORKS_AT` | Person -> Company | `role`, `seniority`, `start_date`, `is_current` |
| `KNOWS` | Person -> Person | `strength`, `source`, `intro_path`, `last_contact` |
| `INFLUENCES` | Person -> Deal | `role` (champion/blocker/evaluator), `influence_score` |
| `PART_OF` | Person -> BuyingGroup | `role`, `engagement_level` |
| `INVOLVED_IN` | Company -> Deal | `type` (buyer/partner/competitor) |
| `PARTICIPATED_IN` | Person -> Activity | `role` (sent/received/attended) |
| `GENERATED` | Activity -> Signal | `extraction_confidence` |
| `OWNS` | User -> Deal/Task | `assigned_at` |
| `CHILD_OF` | Company -> Company | `relationship_type` (subsidiary/partner) |
| `TAGGED_WITH` | Any -> Tag | `created_by`, `created_at` |
| `RELATED_TO` | Activity -> Deal/Person/Company | general-purpose link for timeline |

---

## 4. Event Stream (`crm_events`)

All CRM events land in the `crm_events` partitioned table (monthly partitions) and are published to **Redis Streams** for real-time consumption.

```
crm_events
├── Partitioned by RANGE (created_at) — monthly buckets
├── Indexes: (tenant_id, created_at DESC), (entity_type, entity_id, created_at DESC), (event_type, created_at DESC)
└── No PK constraint (UUID id + partition key)
```

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | NOT NULL, default `gen_random_uuid()` |
| tenant_id | UUID | NOT NULL |
| event_type | TEXT | NOT NULL — e.g. `email.received`, `deal.stage_changed`, `contact.created` |
| source | TEXT | NOT NULL — `gmail`, `zoom`, `user`, `ai_engine` |
| actor_id | UUID | who/what triggered the event |
| entity_type | TEXT | NOT NULL — `deal`, `person`, `activity`, etc. |
| entity_id | UUID | NOT NULL |
| payload | JSONB | NOT NULL — event-specific data |
| metadata | JSONB | provenance, model version, confidence |
| created_at | TIMESTAMPTZ | NOT NULL, default `NOW()` |

Consumers include: Reality Score engine, graph writer, notification service, workflow engine, webhook dispatcher.

---

## 5. Embeddings (pgvector)

Two embedding tables exist, both using 1536-dimensional vectors (voyage-3 compatible) with HNSW indexes for approximate nearest-neighbor cosine search.

### `entity_embeddings` *(012)*

General-purpose embeddings for contacts, companies, deals, and activities. Used for "find similar deals", semantic search, and RAG context retrieval.

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| tenant_id | UUID | NOT NULL, FK `tenants(id)` CASCADE |
| entity_type | TEXT | NOT NULL (`contact`, `company`, `deal`, `activity`) |
| entity_id | UUID | NOT NULL |
| model | TEXT | NOT NULL, default `'voyage-3'` |
| embedding | VECTOR(1536) | NOT NULL, HNSW indexed (cosine) |
| input_text | TEXT | the text that was embedded (audit/regen) |
| created_at / updated_at | TIMESTAMPTZ | |
| | | UNIQUE `(tenant_id, entity_type, entity_id, model)` |

### `node_embeddings` *(001)*

Legacy/conditional embedding table (created only when pgvector extension is pre-installed).

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| tenant_id | UUID | NOT NULL |
| node_id | TEXT | NOT NULL |
| node_label | TEXT | NOT NULL |
| embedding | VECTOR(1536) | NOT NULL, HNSW indexed |
| content_hash | TEXT | NOT NULL |
| model | TEXT | NOT NULL |
| created_at | TIMESTAMPTZ | NOT NULL |
| | | UNIQUE `(tenant_id, node_id)` |

### `review_queue.embedding` *(012)*

The `review_queue` table also carries an optional `VECTOR(1536)` column with its own HNSW index. This enables RAG-style retrieval of similar past review decisions during manual review.
