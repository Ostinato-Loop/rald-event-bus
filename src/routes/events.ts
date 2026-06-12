// RALD Event Bus — Event Publication & Fan-out
// Every major RALD action publishes here. Subscribers receive fan-out.
// LILCKY STUDIO LIMITED

import { Hono } from "hono";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Bindings, Variables } from "../index";
import { getClientIp, generateHmacSignature } from "../lib/auth";
import { checkRateLimit } from "../lib/rate-limit";
import { writeAuditLog } from "../lib/audit";
import type { PublishEventRequest, RaldEvent, EventSubscription } from "../types/events";

const events = new Hono<{ Bindings: Bindings; Variables: Variables }>();

function requireInternal(secret: string | undefined, env: Bindings): boolean {
  return secret === env.RALD_INTERNAL_SECRET;
}

// ── POST /events — publish an event ───────────────────────────────────────────
events.post("/events", async (c) => {
  const secret = c.req.header("X-Internal-Secret");
  if (!requireInternal(secret, c.env)) return c.json({ error: "Unauthorized" }, 401);
  const db: SupabaseClient = c.get("db");
  const ip = getClientIp(c.req.raw);

  // Rate limit: 500 events/min per source service
  const source = c.req.header("X-Source-Service") ?? "unknown";
  const { allowed } = await checkRateLimit(
    c.env.RATE_LIMIT_KV,
    `event:${source}`,
    500,
    60
  );
  if (!allowed) return c.json({ error: "Rate limit exceeded" }, 429);

  const body = await c.req.json<PublishEventRequest>().catch(() => null);
  if (!body?.event_type || !body.source) {
    return c.json({ error: "event_type and source are required" }, 400);
  }

  const eventId = crypto.randomUUID();
  const event: RaldEvent = {
    event_id:    eventId,
    event_type:  body.event_type,
    source:      body.source,
    user_id:     body.user_id,
    actor_id:    body.actor_id,
    payload:     body.payload ?? {},
    metadata:    body.metadata ?? {},
    created_at:  new Date().toISOString(),
    environment: (c.env.ENVIRONMENT as RaldEvent["environment"]) ?? "production",
  };

  // Persist event to Supabase (7-day retention via DB policy or cron)
  await db.from("event_log").insert({
    event_id:    event.event_id,
    event_type:  event.event_type,
    source:      event.source,
    user_id:     event.user_id ?? null,
    actor_id:    event.actor_id ?? null,
    payload:     event.payload,
    metadata:    event.metadata,
    environment: event.environment,
    status:      "pending",
    created_at:  event.created_at,
  });

  // Fan-out to active subscribers for this event type
  const { data: subs } = await db
    .from("event_subscriptions")
    .select("*")
    .eq("active", true)
    .contains("event_types", [body.event_type]);

  const deliveries: Promise<void>[] = (subs ?? []).map((sub: EventSubscription) =>
    fanOutToSubscriber(event, sub, db)
  );
  // Fire-and-forget deliveries — respond immediately
  c.executionCtx?.waitUntil(Promise.allSettled(deliveries));

  await writeAuditLog(db, {
    action:   "event.published",
    service:  body.source,
    ip,
    metadata: { event_id: eventId, event_type: body.event_type, subscriber_count: (subs ?? []).length },
  });

  return c.json({
    ok:                true,
    event_id:          eventId,
    event_type:        body.event_type,
    subscriber_count:  (subs ?? []).length,
    created_at:        event.created_at,
  }, 202);
});

// ── GET /events — query event log ─────────────────────────────────────────────
events.get("/events", async (c) => {
  const secret = c.req.header("X-Internal-Secret");
  if (!requireInternal(secret, c.env)) return c.json({ error: "Unauthorized" }, 401);
  const db: SupabaseClient = c.get("db");
  const type    = c.req.query("type");
  const source  = c.req.query("source");
  const userId  = c.req.query("user_id");
  const limit   = Math.min(Number(c.req.query("limit") ?? "50"), 200);
  let q = db.from("event_log").select("*").order("created_at", { ascending: false }).limit(limit);
  if (type)   q = q.eq("event_type", type);
  if (source) q = q.eq("source", source);
  if (userId) q = q.eq("user_id", userId);
  const { data, error } = await q;
  if (error) return c.json({ error: "Failed to query events" }, 500);
  return c.json({ events: data ?? [], count: data?.length ?? 0 });
});

// ── GET /events/:id — single event ────────────────────────────────────────────
events.get("/events/:id", async (c) => {
  const secret = c.req.header("X-Internal-Secret");
  if (!requireInternal(secret, c.env)) return c.json({ error: "Unauthorized" }, 401);
  const db: SupabaseClient = c.get("db");
  const { data, error } = await db.from("event_log").select("*").eq("event_id", c.req.param("id")).single();
  if (error || !data) return c.json({ error: "Event not found" }, 404);
  return c.json(data);
});

// ── Fan-out helper ────────────────────────────────────────────────────────────
async function fanOutToSubscriber(
  event: RaldEvent,
  sub: EventSubscription,
  db: SupabaseClient
): Promise<void> {
  const payload = JSON.stringify(event);
  const signature = await generateHmacSignature(payload, sub.secret);
  let status: "delivered" | "failed" = "delivered";
  let errorMsg: string | null = null;
  try {
    const res = await fetch(sub.endpoint_url, {
      method:  "POST",
      headers: {
        "Content-Type":           "application/json",
        "X-RALD-Event-Type":      event.event_type,
        "X-RALD-Event-ID":        event.event_id,
        "X-RALD-Signature":       signature,
        "X-RALD-Timestamp":       event.created_at,
      },
      body: payload,
      signal: AbortSignal.timeout(10000), // 10s timeout
    });
    if (!res.ok) {
      status = "failed";
      errorMsg = `HTTP ${res.status}`;
    }
  } catch (err) {
    status = "failed";
    errorMsg = String(err);
  }
  // Record delivery result
  await db.from("event_deliveries").insert({
    event_id:        event.event_id,
    subscription_id: sub.subscription_id,
    status,
    error_message:   errorMsg,
    delivered_at:    new Date().toISOString(),
  });
  // Update event status
  if (status === "delivered") {
    await db.from("event_log")
      .update({ status: "delivered", delivered_at: new Date().toISOString() })
      .eq("event_id", event.event_id);
  }
}

export default events;
