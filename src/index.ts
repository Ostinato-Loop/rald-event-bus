// RALD Event Bus — Cloudflare Worker
// Deployed at: events.rald.cloud
// Version: 2.0.0
// Phase 5: Added Dead Letter Queue (/dlq/*) and Event Replay (/replay)
// LILCKY STUDIO LIMITED · 2026-06-17

import { Hono } from "hono";
import { cors } from "hono/cors";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { KVNamespace } from "./lib/rate-limit";

import healthRoutes       from "./routes/health";
import eventsRoutes       from "./routes/events";
import subscriptionRoutes from "./routes/subscriptions";
import auditStreamRoutes  from "./routes/audit";
import dlqRoutes          from "./routes/dlq";
import replayRoutes       from "./routes/replay";
import { requestLogger }  from "./lib/logger";

export type Bindings = {
  SUPABASE_URL:              string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  RALD_JWT_SECRET:           string;
  RALD_INTERNAL_SECRET?:     string;
  ENVIRONMENT:               string;
  SERVICE_NAME:              string;
  SERVICE_VERSION:           string;
  RATE_LIMIT_KV:             KVNamespace;
  FLAG_CACHE_KV:             KVNamespace;
  OPEN_OBSERVE_API_KEY?:     string;
  OPEN_OBSERVE_ENDPOINT?:    string;
};

export type Variables = {
  db: SupabaseClient;
};

const VERSION = "2.0.0";

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// ── Health bypass — MUST be FIRST ─────────────────────────────────────────────
app.get("/health",  (c) => c.json({ status: "ok", service: "rald-event-bus", version: VERSION, timestamp: new Date().toISOString() }));
app.get("/healthz", (c) => c.json({ status: "ok", service: "rald-event-bus", timestamp: new Date().toISOString() }));
app.get("/readyz",  (c) => c.json({ status: "ok", service: "rald-event-bus", timestamp: new Date().toISOString() }));
app.get("/version", (c) => c.json({ service: "rald-event-bus", version: VERSION, owner: "LILCKY STUDIO LIMITED", os_phase: "5 — DLQ + Replay" }));

// ── Security headers ──────────────────────────────────────────────────────────
app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options",         "DENY");
  c.header("Strict-Transport-Security","max-age=31536000; includeSubDomains");
  c.header("Referrer-Policy",         "no-referrer");
  c.header("X-RALD-Version",          VERSION);
  c.header("X-RALD-Service",          "event-bus");
});

app.use("*", requestLogger("rald-event-bus"));

// ── CORS — internal RALD services + api.rald.cloud ───────────────────────────
app.use("*", cors({
  origin: (origin) => {
    const allowed = new Set([
      "https://auth.rald.cloud",        "https://api.rald.cloud",
      "https://loop-api.rald.cloud",    "https://chat.rald.cloud",
      "https://notification.rald.cloud","https://realtime.rald.cloud",
      "https://inbox.rald.cloud",       "https://search.rald.cloud",
      "https://config.rald.cloud",      "https://control.rald.cloud",
      "https://admin.rald.cloud",       "https://pay.rald.cloud",
    ]);
    return allowed.has(origin ?? "") ? origin : null;
  },
  allowMethods:  ["GET","POST","DELETE","OPTIONS"],
  allowHeaders:  ["Content-Type","Authorization","X-Internal-Secret","X-Source-Service","X-RALD-Internal-Key"],
  exposeHeaders: ["X-RALD-Event-ID","X-RALD-Request-ID"],
}));

// ── Boot validation + Supabase client ─────────────────────────────────────────
app.use("*", async (c, next) => {
  const required = ["SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","RALD_JWT_SECRET"];
  for (const key of required) {
    if (!c.env[key as keyof Bindings]) {
      return c.json({ error: `Missing required env: ${key}` }, 503);
    }
  }
  c.set("db", createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  }));
  return next();
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.route("/", healthRoutes);
app.route("/", eventsRoutes);
app.route("/", subscriptionRoutes);
app.route("/", auditStreamRoutes);
app.route("/", dlqRoutes);     // Phase 5: Dead Letter Queue
app.route("/", replayRoutes);  // Phase 5: Event Replay

app.get("/system/status", (c) => c.json({
  status:  "operational",
  version: VERSION,
  features: {
    events:       "✓ POST /events (publish + fan-out)",
    subscriptions:"✓ GET/POST/DELETE /subscriptions",
    audit:        "✓ GET /audit",
    dlq:          "✓ GET/POST /dlq, /dlq/stats, /dlq/:id/retry|drop, /dlq/retry-all",
    replay:       "✓ POST /replay, GET /replay/history",
  },
  timestamp: new Date().toISOString(),
}));

app.notFound((c) => c.json({ error: "Not found" }, 404));
app.onError((err, c) => {
  console.error("[event-bus] unhandled error:", err);
  return c.json({ error: "Internal server error" }, 500);
});

export default app;
