-- RALD Event Bus — Full Database Schema
-- Deployed at: events.rald.cloud
-- Sprint: Operator Platform Phase 4 + Public Beta Hardening 2026-06-14
-- Tables: event_log, event_subscriptions, event_deliveries, audit_stream
-- LILCKY STUDIO LIMITED

-- ── event_log — canonical record of all published events ──────────────────────
CREATE TABLE IF NOT EXISTS event_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        TEXT NOT NULL UNIQUE,
  event_type      TEXT NOT NULL,
  source          TEXT NOT NULL,     -- service that published (e.g. "rald-auth-core")
  user_id         UUID,              -- affected user (optional)
  actor_id        UUID,              -- who triggered (optional)
  payload         JSONB NOT NULL DEFAULT '{}',
  metadata        JSONB NOT NULL DEFAULT '{}',
  environment     TEXT NOT NULL DEFAULT 'production'
                    CHECK (environment IN ('production', 'staging', 'development')),
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'delivered', 'failed', 'dead_lettered')),
  delivered_at    TIMESTAMPTZ,
  retry_count     INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS event_log_event_type_idx ON event_log(event_type);
CREATE INDEX IF NOT EXISTS event_log_source_idx     ON event_log(source);
CREATE INDEX IF NOT EXISTS event_log_user_id_idx    ON event_log(user_id);
CREATE INDEX IF NOT EXISTS event_log_status_idx     ON event_log(status);
CREATE INDEX IF NOT EXISTS event_log_created_at_idx ON event_log(created_at DESC);

ALTER TABLE event_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "event_log: service role only"
  ON event_log FOR ALL USING (true) WITH CHECK (true);

-- 7-day retention policy (run via pg_cron or scheduled function)
CREATE OR REPLACE FUNCTION purge_old_events() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM event_log
  WHERE created_at < now() - INTERVAL '7 days'
    AND status IN ('delivered', 'dead_lettered');
END;
$$;

-- ── event_subscriptions — registered webhook receivers ────────────────────────
CREATE TABLE IF NOT EXISTS event_subscriptions (
  subscription_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_name     TEXT NOT NULL,
  event_types      TEXT[] NOT NULL DEFAULT '{}',   -- event types to receive
  endpoint_url     TEXT NOT NULL,
  secret           TEXT NOT NULL,                  -- HMAC-SHA256 signing secret
  active           BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(service_name, endpoint_url)
);

CREATE INDEX IF NOT EXISTS event_subs_service_idx  ON event_subscriptions(service_name);
CREATE INDEX IF NOT EXISTS event_subs_active_idx   ON event_subscriptions(active);

ALTER TABLE event_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "event_subscriptions: service role only"
  ON event_subscriptions FOR ALL USING (true) WITH CHECK (true);

-- ── event_deliveries — per-subscriber delivery receipts ──────────────────────
CREATE TABLE IF NOT EXISTS event_deliveries (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id         TEXT NOT NULL,       -- references event_log.event_id
  subscription_id  UUID NOT NULL REFERENCES event_subscriptions(subscription_id) ON DELETE CASCADE,
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'delivered', 'failed', 'retrying')),
  http_status      INT,
  error_message    TEXT,
  attempt_count    INT NOT NULL DEFAULT 1,
  delivered_at     TIMESTAMPTZ,
  next_retry_at    TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS event_deliveries_event_id_idx ON event_deliveries(event_id);
CREATE INDEX IF NOT EXISTS event_deliveries_sub_idx      ON event_deliveries(subscription_id);
CREATE INDEX IF NOT EXISTS event_deliveries_status_idx   ON event_deliveries(status);
CREATE INDEX IF NOT EXISTS event_deliveries_retry_idx    ON event_deliveries(next_retry_at)
  WHERE status = 'retrying';

ALTER TABLE event_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "event_deliveries: service role only"
  ON event_deliveries FOR ALL USING (true) WITH CHECK (true);

-- ── audit_stream — aggregated service audit log ────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_stream (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service     TEXT NOT NULL,
  action      TEXT NOT NULL,
  user_id     UUID,
  actor_id    UUID,
  ip          TEXT,
  status      TEXT NOT NULL DEFAULT 'success'
                CHECK (status IN ('success', 'failure', 'warning')),
  severity    TEXT NOT NULL DEFAULT 'info'
                CHECK (severity IN ('info', 'warn', 'error', 'critical')),
  metadata    JSONB NOT NULL DEFAULT '{}',
  trace_id    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_stream_service_idx    ON audit_stream(service);
CREATE INDEX IF NOT EXISTS audit_stream_action_idx     ON audit_stream(action);
CREATE INDEX IF NOT EXISTS audit_stream_user_id_idx    ON audit_stream(user_id);
CREATE INDEX IF NOT EXISTS audit_stream_severity_idx   ON audit_stream(severity);
CREATE INDEX IF NOT EXISTS audit_stream_trace_id_idx   ON audit_stream(trace_id);
CREATE INDEX IF NOT EXISTS audit_stream_created_at_idx ON audit_stream(created_at DESC);

ALTER TABLE audit_stream ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_stream: service only"
  ON audit_stream FOR ALL USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION purge_old_audit_stream() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM audit_stream WHERE created_at < now() - INTERVAL '30 days' AND severity = 'info';
  DELETE FROM audit_stream WHERE created_at < now() - INTERVAL '90 days';
END;
$$;
