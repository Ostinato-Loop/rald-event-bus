// RALD OS Phase 5 — Event Replay Engine
// Replay events by type, time range, or source service.
// Useful for onboarding new subscribers, recovering after outages,
// and debugging missing fan-out deliveries.
// LILCKY STUDIO LIMITED · 2026-06-17

import { Hono } from "hono";
import type { Bindings, Variables } from "../index";
import { requireMachineAuth } from "../lib/machine-auth";

const replay = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// ── POST /replay — start a replay job ─────────────────────────────────────────
replay.post("/replay", requireMachineAuth("events:write"), async (c) => {
  const db   = c.get("db") as any;
  const body = await c.req.json<{
    event_types?:      string[];
    source?:           string;
    since?:            string;   // ISO8601 — replay events after this time
    until?:            string;   // ISO8601 — replay events before this time
    target_service?:   string;   // replay to a specific subscriber only
    limit?:            number;
  }>().catch(() => null);

  if (!body) return c.json({ error: "Invalid body" }, 400);
  if (!body.since && !body.event_types?.length) {
    return c.json({ error: "Must specify at least 'since' or 'event_types'" }, 400);
  }

  const limit = Math.min(body.limit ?? 500, 5000);
  const since = body.since ?? new Date(Date.now() - 86_400_000).toISOString(); // default: last 24h

  let query = db
    .from("event_store")
    .select("event_id,event_type,source,user_id,payload,metadata,created_at")
    .gte("created_at", since)
    .in("status", ["delivered", "dead_letter", "failed"])
    .order("created_at", { ascending: true })
    .limit(limit);

  if (body.until)                 query = query.lte("created_at", body.until);
  if (body.event_types?.length)   query = query.in("event_type", body.event_types);
  if (body.source)                query = query.eq("source", body.source);

  const { data: events, error } = await query;
  if (error) return c.json({ error: "Failed to query events for replay" }, 500);
  if (!events?.length) return c.json({ ok: true, replayed: 0, message: "No events matched the criteria" });

  // Insert replay copies as pending events (preserves originals, creates fresh delivery)
  const replayCopies = (events as any[]).map((e) => ({
    event_type:  e.event_type,
    source:      e.source,
    user_id:     e.user_id,
    payload:     { ...(e.payload ?? {}), _replay: true, _original_event_id: e.event_id, _original_at: e.created_at },
    metadata:    { ...(e.metadata ?? {}), replay: true, replayed_at: new Date().toISOString(), target_service: body.target_service ?? null },
    environment: "production",
    status:      "pending",
    attempt_count: 0,
  }));

  const { error: insertError } = await db.from("event_store").insert(replayCopies);
  if (insertError) return c.json({ error: "Failed to create replay events" }, 500);

  return c.json({
    ok:               true,
    replayed:         replayCopies.length,
    event_types:      [...new Set(events.map((e: any) => e.event_type))],
    since,
    until:            body.until ?? new Date().toISOString(),
    target_service:   body.target_service ?? "all",
    message:          `${replayCopies.length} events queued for replay delivery`,
  }, 202);
});

// ── GET /replay/history — list recent replay operations ───────────────────────
replay.get("/replay/history", requireMachineAuth("events:read"), async (c) => {
  const db = c.get("db") as any;

  // Find replay events from the past 7 days
  const { data } = await db
    .from("event_store")
    .select("event_id,event_type,source,status,created_at,metadata")
    .filter("metadata->replay", "eq", true)
    .gte("created_at", new Date(Date.now() - 604_800_000).toISOString())
    .order("created_at", { ascending: false })
    .limit(100);

  const byType: Record<string, number> = {};
  (data ?? []).forEach((e: any) => {
    byType[e.event_type] = (byType[e.event_type] ?? 0) + 1;
  });

  return c.json({
    total_replays:  data?.length ?? 0,
    by_event_type:  byType,
    recent:         (data ?? []).slice(0, 10),
    generated_at:   new Date().toISOString(),
  });
});

export default replay;
