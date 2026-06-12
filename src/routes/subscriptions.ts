// RALD Event Bus — Subscription Management
// Services register here to receive event fan-outs.
// LILCKY STUDIO LIMITED

import { Hono } from "hono";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Bindings, Variables } from "../index";
import { getClientIp } from "../lib/auth";
import { writeAuditLog } from "../lib/audit";
import type { RaldEventType } from "../types/events";
import { requireMachineAuth } from "../lib/machine-auth";

const subscriptions = new Hono<{ Bindings: Bindings; Variables: Variables }>();


// ── GET /subscriptions — list all (internal only) ─────────────────────────────
subscriptions.get("/subscriptions", requireMachineAuth("events:read"), async (c) => {
  const db: SupabaseClient = c.get("db");
  const { data, error } = await db
    .from("event_subscriptions")
    .select("subscription_id,service_name,event_types,endpoint_url,active,created_at")
    .order("created_at", { ascending: false });
  if (error) return c.json({ error: "Failed to list subscriptions" }, 500);
  return c.json({ subscriptions: data ?? [] });
});

// ── POST /subscriptions — register a subscription ─────────────────────────────
subscriptions.post("/subscriptions", requireMachineAuth("events:write"), async (c) => {
  const db: SupabaseClient = c.get("db");
  const ip = getClientIp(c.req.raw);
  const body = await c.req.json<{
    service_name:  string;
    event_types:   RaldEventType[];
    endpoint_url:  string;
    webhook_secret?: string;
  }>().catch(() => null);
  if (!body?.service_name || !body.event_types?.length || !body.endpoint_url) {
    return c.json({ error: "service_name, event_types[], and endpoint_url are required" }, 400);
  }
  const webhookSecret = body.webhook_secret ?? (await generateSecret());
  const { data, error } = await db.from("event_subscriptions").insert({
    service_name: body.service_name,
    event_types:  body.event_types,
    endpoint_url: body.endpoint_url,
    secret:       webhookSecret,
    active:       true,
  }).select("subscription_id,service_name,event_types,endpoint_url,active,created_at").single();
  if (error) return c.json({ error: "Failed to create subscription" }, 500);
  await writeAuditLog(db, {
    action:   "subscription.created",
    service:  body.service_name,
    ip,
    metadata: { event_types: body.event_types, endpoint_url: body.endpoint_url },
  });
  return c.json({ ...data, webhook_secret: webhookSecret }, 201);
});

// ── DELETE /subscriptions/:id — deactivate subscription ───────────────────────
subscriptions.delete("/subscriptions/:id", requireMachineAuth("events:write"), async (c) => {
  const db: SupabaseClient = c.get("db");
  const ip = getClientIp(c.req.raw);
  const id = c.req.param("id");
  await db.from("event_subscriptions").update({ active: false }).eq("subscription_id", id);
  await writeAuditLog(db, { action: "subscription.deactivated", ip, metadata: { subscription_id: id } });
  return c.json({ ok: true, subscription_id: id, active: false });
});

async function generateSecret(): Promise<string> {
  const buf = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(buf).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default subscriptions;
