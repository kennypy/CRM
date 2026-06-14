-- Migration 034: Webhook authenticity secrets
-- Security fix (C2): inbound provider webhooks (Microsoft Graph / Outlook,
-- Google Pub/Sub Gmail, Google Calendar push) previously trusted client-supplied
-- identifiers (clientState == tenant_id, X-Goog-Channel-ID) with no authenticity
-- verification.
--
-- Per-subscription / per-channel random secrets are now generated at
-- subscription-creation time and stored in oauth_tokens.metadata (the same JSONB
-- column already used for outlook_subscription_id, gcal_channel_id, etc.). On each
-- inbound notification the connector verifies the incoming token against the stored
-- secret using a constant-time comparison and resolves the real tenant_id/user_id
-- from the stored row instead of trusting the request.
--
-- New metadata keys (documented here; stored in the existing JSONB column):
--   provider = 'microsoft':
--     outlook_client_state_secret  TEXT  -- random per-subscription secret; the
--                                            value sent to Graph as `clientState`
--                                            and echoed back on every notification
--   provider = 'google' (Calendar watch):
--     gcal_channel_token           TEXT  -- random per-channel token; sent to Google
--                                            as the channel `token` and returned in
--                                            the X-Goog-Channel-Token header
--   provider = 'google' (Gmail watch):
--     gmail_email_address          TEXT  -- the watched mailbox address; used to
--                                            resolve an inbound Pub/Sub push (which
--                                            carries only emailAddress) back to its
--                                            owning tenant_id/user_id (C3). Gmail push
--                                            requests are additionally authenticated
--                                            via the Google-signed OIDC JWT (C2).
--
-- No column changes are required because these are stored inside the existing
-- oauth_tokens.metadata JSONB. This migration adds documentation + a partial index
-- to make subscription/channel lookups efficient and to record the schema change.

COMMENT ON COLUMN oauth_tokens.metadata IS
  'Provider-specific integration state (JSONB). Includes webhook authenticity '
  'secrets: outlook_client_state_secret (microsoft), gcal_channel_token (google). '
  'See migration 034.';

-- Speed up the webhook handler lookups that resolve a subscription/channel back to
-- its owning tenant/user row.
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_outlook_subscription
  ON oauth_tokens ((metadata->>'outlook_subscription_id'))
  WHERE metadata->>'outlook_subscription_id' IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_oauth_tokens_gcal_channel
  ON oauth_tokens ((metadata->>'gcal_channel_id'))
  WHERE metadata->>'gcal_channel_id' IS NOT NULL;

-- Resolve a Gmail Pub/Sub push (keyed only by mailbox address) to its owner.
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_gmail_email
  ON oauth_tokens ((lower(metadata->>'gmail_email_address')))
  WHERE metadata->>'gmail_email_address' IS NOT NULL;
