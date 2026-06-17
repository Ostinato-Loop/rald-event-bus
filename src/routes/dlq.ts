// RALD OS Phase 5 — Dead Letter Queue Management
// Failed events that exhausted all retry attempts land here.
// Operators can inspect, retry, or drop them from the dashboard.
// LILCKY STUDIO LIMITED · 2026-06-17

import { Hono } from "hono";
import type { Bindings, Variables } from "../index";
import { requireMachineAuth } from "../lib/machine-auth";

const dlq = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// ── GET /dlq — list dead letter items ──────────────────────────────────────────
dlq.get("/dlq", requireMachineAuth("events:read"), async (c) => {
  const db     = c.get("db") as any;
  const limit  = Math.min(100, Number(c.req.query("limit") ?? "50"));
  const source = c.req.query("source");
  const type   = c.req.query("event_type");

  let query = db
    .from("event_store")
    .select("event_id,event_type,source,user_id,payload,metadata,created_at,attempt_count,last_error")
    .eq("status", "dead_letter")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (source) query = query.eq("source", source);
  if (type)   query = query.eq("event_type", type);

  const { data, error } = await query;
  if (error) return c.json({ error: "Failed to query DLQ" }, 500);

  return c.json({
    dead_letters: data ?? [],
    count:        data?.length ?? 0,
    generated_at: new Date().toISOString(),
  });
});

// ── GET /dlq/stats — DLQ breakdown by source + event_type ─────────────────────
dlq.get("/dlq/stats", requireMachineAuth("events:read"), async (c) => {
  const db = c.get("db") as any;

  const { data } = await db
    .from("event_store")
    .select("event_type,source,attempt_count")
    .eq("status", "dead_letter");

  const byType: Record<string, number>   = {};
  const bySource: Record<string, number> = {};
  let maxAttempts = 0;

  (data ?? []).forEach((r: any) => {
    byType[r.event_type]   = (byType[r.event_type] ?? 0) + 1;
    bySource[r.source]     = (bySource[r.source] ?? 0) + 1;
    if ((r.attempt_count ?? 0) > maxAttempts) maxAttempts = r.attempt_count;
  });

  return c.json({
    total:          data?.length ?? 0,
    by_event_type:  byType,
    by_source:      bySource,
    max_attempts:   maxAttempts,
    generated_at:   new Date().toISOString(),
  });
});

// ── POST /dlq/:event_id/retry — re-queue a dead letter event ──────────────────
dlq.post("/dlq/:event_id/retry", requireMachineAuth("events:write"), async (c) => {
  const db      = c.get("db") as any;
  const eventId = c.req.param("event_id");

  const { data: event } = await db
    .from("event_store")
    .select("*")
    .eq("event_id", eventId)
    .eq("status", "dead_letter")
    .maybeSingle();

  if (!event) return c.json({ error: "Dead letter event not found" }, 404);

  // Reset to pending so the fan-out job picks it up again
  const { error } = await db.from("event_store").update({
    status:        "pending",
    attempt_count: 0,
    last_error:    null,
    next_delivery_at: new Date().toISOString(),
    updated_at:    new Date().toISOString(),
  }).eq("event_id", eventId);

  if (error) return c.json({ error: "Failed to re-queue event" }, 500);

  return c.json({
    ok:         true,
    event_id:   eventId,
    event_type: event.event_type,
    status:     "pending",
    message:    "Event re-queued for delivery",
  });
});

// ── POST /dlq/:event_id/drop — permanently discard a dead letter ───────────────
dlq.post("/dlq/:event_id/drop", requireMachineAuth("events:write"), async (c) => {
  const db      = c.get("db") as any;
  const eventId = c.req.param("event_id");
  const body    = await c.req.json<{ reason?: string }>().catch(() => ({}));

  const { data: event } = await db
    .from("event_store")
    .select("event_id,event_type,source")
    .eq("event_id", eventId)
    .maybeSingle();

  if (!event) return c.json({ error: "Event not found" }, 404);

  const { error } = await db.from("event_store").update({
    status:     "dropped",
    last_error: body.reason ? `Manually dropped: ${body.reason}` : "Manually dropped",
    updated_at: new Date().toISOString(),
  }).eq("event_id", eventId);

  if (error) return c.json({ error: "Failed to drop event" }, 500);

  return c.json({
    ok:         true,
    event_id:   eventId,
    event_type: event.event_type,
    status:     "dropped",
  });
});

// ── POST /dlq/retry-all — re-queue ALL dead letter events ─────────────────────
dlq.post("/dlq/retry-all", requireMachineAuth("events:write"), async (c) => {
  const db   = c.get("db") as any;
  const type = c.req.query("event_type");

  let query = db.from("event_store")
    .update({
      status:           "pending",
      attempt_count:    0,
      last_error:       null,
      next_delivery_at: new Date().toISOString(),
      updated_at:       new Date().toISOString(),
    })
    .eq("status", "dead_letter");

  if (type) query = query.eq("event_type", type);

  const { error, count } = await query;
  if (error) return c.json({ error: "Failed to retry all" }, 500);

  return c.json({ ok: true, requeued: count ?? 0 });
});

export default dlq;
