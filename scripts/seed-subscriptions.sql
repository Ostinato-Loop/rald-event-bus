-- RALD Event Bus — Subscription Seed
-- Wires the identity.created fan-out to the identity provisioning chain.
-- LILCKY STUDIO LIMITED
--
-- Run once against: onxdcikfttdmnhofsuwo.supabase.co
-- The secret MUST match the RALD_INTERNAL_SECRET Cloudflare Worker secret
-- set on rald-event-bus. Obtain it from: wrangler secret list (rald-event-bus)
--
-- HOW TO RUN:
--   SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/run-seed.mjs
-- OR paste directly into Supabase SQL editor.

-- ── identity.created → provisioning chain ────────────────────────────────────
INSERT INTO event_subscriptions (
  service_name,
  event_types,
  endpoint_url,
  secret,
  active
)
VALUES (
  'identity-provisioner',
  ARRAY['identity.created'],
  'https://events.rald.cloud/internal/provision-identity',
  'REPLACE_WITH_RALD_INTERNAL_SECRET',
  true
)
ON CONFLICT (service_name, endpoint_url) DO UPDATE
  SET event_types  = EXCLUDED.event_types,
      active       = true,
      updated_at   = now();

-- ── identity.provisioned → audit log ─────────────────────────────────────────
INSERT INTO event_subscriptions (
  service_name,
  event_types,
  endpoint_url,
  secret,
  active
)
VALUES (
  'audit-collector',
  ARRAY['identity.provisioned', 'identity.provision_partial'],
  'https://notification.rald.cloud/internal/audit-ingest',
  'REPLACE_WITH_RALD_INTERNAL_SECRET',
  true
)
ON CONFLICT (service_name, endpoint_url) DO UPDATE
  SET event_types  = EXCLUDED.event_types,
      active       = true,
      updated_at   = now();

-- ── rald_alias_registry — backing table for rald-routing alias provision ──────
CREATE TABLE IF NOT EXISTS rald_alias_registry (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alias        TEXT NOT NULL UNIQUE,           -- e.g. boyd@rald
  rald_id      TEXT NOT NULL,                  -- e.g. boyd
  user_id      UUID NOT NULL UNIQUE,           -- FK → users
  display_name TEXT,
  country      TEXT,
  verified     BOOLEAN NOT NULL DEFAULT false,
  active       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rald_alias_rald_id_idx  ON rald_alias_registry(rald_id);
CREATE INDEX IF NOT EXISTS rald_alias_user_id_idx  ON rald_alias_registry(user_id);
CREATE INDEX IF NOT EXISTS rald_alias_active_idx   ON rald_alias_registry(active);

ALTER TABLE rald_alias_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rald_alias_registry: service role only"
  ON rald_alias_registry FOR ALL USING (true) WITH CHECK (true);
