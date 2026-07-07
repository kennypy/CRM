-- 038_scheduler.sql
-- Meetings scheduler — public booking links (Calendly / HubSpot Meetings style).
--
-- A user publishes a booking link with weekly availability; invitees pick an
-- open slot on a public page (/book/:slug, resolved before the auth hook) and
-- book a meeting. Tenant-scoped like the rest of the CRM.

BEGIN;

CREATE TABLE IF NOT EXISTS booking_links (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  owner_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug             TEXT NOT NULL UNIQUE,          -- globally unique → clean /book/:slug URLs
  title            TEXT NOT NULL,
  description      TEXT,
  duration_minutes INTEGER NOT NULL DEFAULT 30 CHECK (duration_minutes BETWEEN 5 AND 480),
  timezone         TEXT NOT NULL DEFAULT 'UTC',
  -- Weekly availability: { "weekdays": [1,2,3,4,5], "startTime": "09:00", "endTime": "17:00" }
  -- weekdays use JS getUTCDay() semantics (0=Sun … 6=Sat), interpreted in `timezone`.
  availability     JSONB NOT NULL DEFAULT '{"weekdays":[1,2,3,4,5],"startTime":"09:00","endTime":"17:00"}'::jsonb,
  buffer_minutes   INTEGER NOT NULL DEFAULT 0 CHECK (buffer_minutes BETWEEN 0 AND 120),
  active           BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_booking_links_tenant ON booking_links(tenant_id, owner_id);

CREATE TRIGGER booking_links_updated_at BEFORE UPDATE ON booking_links
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE IF NOT EXISTS bookings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  booking_link_id   UUID NOT NULL REFERENCES booking_links(id) ON DELETE CASCADE,
  invitee_name      TEXT NOT NULL,
  invitee_email     TEXT NOT NULL,
  invitee_notes     TEXT,
  start_time        TIMESTAMPTZ NOT NULL,
  end_time          TIMESTAMPTZ NOT NULL,
  status            TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Prevent two confirmed bookings on the exact same link + start slot (race-safe).
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_slot
  ON bookings(booking_link_id, start_time) WHERE status = 'confirmed';
CREATE INDEX IF NOT EXISTS idx_bookings_tenant ON bookings(tenant_id, start_time);

COMMIT;
