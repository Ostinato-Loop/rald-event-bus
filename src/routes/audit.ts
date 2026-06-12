// RALD Event Bus — Audit Stream Routes
// Sprint: Operator Platform Phase 4 · 2026-06-12
// Updated: Machine Identity Phase 9 — requireMachineAuth() replaces requireInternal()
// LILCKY STUDIO LIMITED

import { Hono } from "hono";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Bindings, Variables } from "../index";
import { getClientIp } from "../lib/auth";
import { writeAuditLog } from "../lib/audit";
import { requireMachineAuth, requireAdminSecret } from "../lib/machine-auth";

const auditStream = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// ── POST /audit — ingest an audit event from any RALD service ─────────────────
// Requires scope: "audit:write"
auditStream.post("/audit", requireMachineAuth("audit:write"), async (c) => {
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
// Requires scope: "audit:read"
auditStream.get("/audit", requireMachineAuth("audit:read"), async (c) => {
  const db: SupabaseClient = c.get("db");
  const service   = c.req.query("service");
  const action    = c.req.query("action");
  const userId    = c.req.query("user_id");
  const severity  = c.req.query("severity");
  const traceId   = c.req.query("trace_id");
  const since     = c.req.query("since");
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
// Requires scope: "audit:read"
auditStream.get("/audit/security", requireMachineAuth("audit:read"), async (c) => {
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
