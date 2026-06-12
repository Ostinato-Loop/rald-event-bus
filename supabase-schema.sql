-- RALD Event Bus — Audit Stream Table
-- Sprint: Operator Platform Phase 4 · 2026-06-12
-- Aggregated audit stream for all RALD services.
-- LILCKY STUDIO LIMITED

CREATE TABLE IF NOT EXISTS audit_stream (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service     TEXT NOT NULL,
  action      TEXT NOT NULL,
  user_id     UUID,
  actor_id    UUID,
  ip          TEXT,
  status      TEXT NOT NULL DEFAULT 'success'
                CHECK (status IN ('success','failure','warning')),
  severity    TEXT NOT NULL DEFAULT 'info'
                CHECK (severity IN ('info','warn','error','critical')),
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

-- ── Partition/cleanup function (30-day retention) ─────────────────────────────
CREATE OR REPLACE FUNCTION purge_old_audit_stream() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM audit_stream WHERE created_at < now() - INTERVAL '30 days' AND severity = 'info';
  DELETE FROM audit_stream WHERE created_at < now() - INTERVAL '90 days'; -- hard delete all after 90 days
END;
$$;
