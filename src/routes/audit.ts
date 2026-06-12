// RALD Event Bus — Audit Stream Routes
// Sprint: Operator Platform Phase 4 · 2026-06-12
// Aggregated audit stream across all RALD services.
// All services post audit events here; operators query from one place.
// LILCKY STUDIO LIMITED

import { Hono } from "hono";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Bindings, Variables } from "../index";
import { getClientIp } from "../lib/auth";
import { writeAuditLog } from "../lib/audit";

const auditStream = new Hono<{ Bindings: Bindings; Variables: Variables }>();

function requireInternal(secret: string | undefined, env: Bindings): boolean {
  return secret === env.RALD_INTERNAL_SECRET;
}

// ── POST /audit — ingest an audit event from any RALD service ─────────────────
auditStream.post("/audit", async (c) => {
  const secret = c.req.header("X-Internal-Secret");
  if (!requireInternal(secret, c.env)) return c.json({ error: "Unauthorized" }, 401);
  const db: SupabaseClient = c.get("db");
  const ip = getClientIp(c.req.raw);
  const body = await c.req.json<{
    service:    string;
    action:     string;
    user_id?:   string;
    actor_id?:  string;
    ip?:        string;
    status:     "success" | "failure" | "warning";
    metadata?:  Record<string, unknown>;
    severity?:  "info" | "warn" | "error" | "critical";
    trace_id?:  string;
  }>().catch(() => null);
  if (!body?.service || !body.action) {
    return c.json({ error: "service and action are required" }, 400);
  }
  const { data, error } = await db.from("audit_stream").insert({
    service:     body.service,
    action:      body.action,
    user_id:     body.user_id ?? null,
    actor_id:    body.actor_id ?? null,
    ip:          body.ip ?? ip,
    status:      body.status ?? "success",
    metadata:    body.metadata ?? {},
    severity:    body.severity ?? "info",
    trace_id:    body.trace_id ?? null,
    created_at:  new Date().toISOString(),
  }).select("id").single();
  if (error) return c.json({ error: "Failed to write audit event" }, 500);
  return c.json({ ok: true, id: data?.id }, 202);
});

// ── GET /audit — query the audit stream ──────────────────────────────────────
auditStream.get("/audit", async (c) => {
  const secret = c.req.header("X-Internal-Secret");
  if (!requireInternal(secret, c.env)) return c.json({ error: "Unauthorized" }, 401);
  const db: SupabaseClient = c.get("db");
  const service   = c.req.query("service");
  const action    = c.req.query("action");
  const userId    = c.req.query("user_id");
  const severity  = c.req.query("severity");
  const traceId   = c.req.query("trace_id");
  const since     = c.req.query("since");   // ISO timestamp
  const limit     = Math.min(Number(c.req.query("limit") ?? "100"), 500);

  let q = db.from("audit_stream").select("*").order("created_at", { ascending: false }).limit(limit);
  if (service)  q = q.eq("service",  service);
  if (action)   q = q.eq("action",   action);
  if (userId)   q = q.eq("user_id",  userId);
  if (severity) q = q.eq("severity", severity);
  if (traceId)  q = q.eq("trace_id", traceId);
  if (since)    q = q.gte("created_at", since);

  const { data, error } = await q;
  if (error) return c.json({ error: "Failed to query audit stream" }, 500);
  return c.json({ events: data ?? [], count: data?.length ?? 0 });
});

// ── GET /audit/security — security-relevant events only ─────────────────────
auditStream.get("/audit/security", async (c) => {
  const secret = c.req.header("X-Internal-Secret");
  if (!requireInternal(secret, c.env)) return c.json({ error: "Unauthorized" }, 401);
  const db: SupabaseClient = c.get("db");
  const limit = Math.min(Number(c.req.query("limit") ?? "50"), 200);
  const { data, error } = await db.from("audit_stream")
    .select("*")
    .in("severity", ["warn", "error", "critical"])
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return c.json({ error: "Failed to query security events" }, 500);
  return c.json({ events: data ?? [], count: data?.length ?? 0 });
});

export default auditStream;
