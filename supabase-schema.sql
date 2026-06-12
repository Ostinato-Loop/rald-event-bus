-- RALD Event Bus — Supabase Schema
-- Sprint: Operator Platform · Event Bus · 2026-06-12
-- LILCKY STUDIO LIMITED

-- ── event_log — persistent event store (7-day retention) ─────────────────────
CREATE TABLE IF NOT EXISTS event_log (
  event_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type    TEXT NOT NULL,
  source        TEXT NOT NULL,
  user_id       UUID,
  actor_id      UUID,
  payload       JSONB NOT NULL DEFAULT '{}',
  metadata      JSONB NOT NULL DEFAULT '{}',
  environment   TEXT NOT NULL DEFAULT 'production',
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','delivered','failed','dead_letter')),
  delivered_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS event_log_event_type_idx  ON event_log(event_type);
CREATE INDEX IF NOT EXISTS event_log_source_idx       ON event_log(source);
CREATE INDEX IF NOT EXISTS event_log_user_id_idx      ON event_log(user_id);
CREATE INDEX IF NOT EXISTS event_log_created_at_idx   ON event_log(created_at DESC);
CREATE INDEX IF NOT EXISTS event_log_status_idx       ON event_log(status);

ALTER TABLE event_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "event_log: service write only"
  ON event_log FOR ALL USING (true) WITH CHECK (true);

-- ── event_subscriptions — registered consumers ────────────────────────────────
CREATE TABLE IF NOT EXISTS event_subscriptions (
  subscription_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_name    TEXT NOT NULL,
  event_types     TEXT[] NOT NULL DEFAULT '{}',
  endpoint_url    TEXT NOT NULL,
  secret          TEXT NOT NULL,
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS event_subscriptions_active_idx ON event_subscriptions(active);

ALTER TABLE event_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "event_subscriptions: service only"
  ON event_subscriptions FOR ALL USING (true) WITH CHECK (true);

-- ── event_deliveries — delivery tracking ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS event_deliveries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID NOT NULL REFERENCES event_log(event_id) ON DELETE CASCADE,
  subscription_id UUID NOT NULL REFERENCES event_subscriptions(subscription_id) ON DELETE CASCADE,
  status          TEXT NOT NULL CHECK (status IN ('delivered','failed','retrying')),
  error_message   TEXT,
  attempt_count   INTEGER NOT NULL DEFAULT 1,
  delivered_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS event_deliveries_event_id_idx   ON event_deliveries(event_id);
CREATE INDEX IF NOT EXISTS event_deliveries_status_idx     ON event_deliveries(status);

ALTER TABLE event_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "event_deliveries: service only"
  ON event_deliveries FOR ALL USING (true) WITH CHECK (true);

-- ── event_bus_audit_logs ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS event_bus_audit_logs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action     TEXT NOT NULL,
  service    TEXT,
  user_id    UUID,
  ip         TEXT,
  metadata   JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS event_bus_audit_created_at_idx ON event_bus_audit_logs(created_at DESC);

ALTER TABLE event_bus_audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "event_bus_audit: service only"
  ON event_bus_audit_logs FOR ALL USING (true) WITH CHECK (true);

-- ── 7-day retention function (call from cron) ─────────────────────────────────
CREATE OR REPLACE FUNCTION purge_old_events() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM event_log WHERE created_at < now() - INTERVAL '7 days' AND status = 'delivered';
  DELETE FROM event_log WHERE created_at < now() - INTERVAL '30 days'; -- hard delete all after 30 days
END;
$$;
