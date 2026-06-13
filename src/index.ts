// RALD Event Bus — Cloudflare Worker
// Deployed at: events.rald.cloud
// Version: 1.0.0
// Purpose: Central event fabric for the RALD ecosystem.
//   Every major action emits an event. Subscribers receive fan-out via webhooks.
//   No direct product-to-product spaghetti APIs.
// LILCKY STUDIO LIMITED

import { Hono } from "hono";
import { cors } from "hono/cors";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { KVNamespace } from "./lib/rate-limit";

import healthRoutes       from "./routes/health";
import eventsRoutes       from "./routes/events";
import subscriptionRoutes from "./routes/subscriptions";
import auditStreamRoutes  from "./routes/audit";
import { requestLogger }   from "./lib/logger";

export type Bindings = {
  SUPABASE_URL:              string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  RALD_JWT_SECRET:           string;
  RALD_INTERNAL_SECRET?:     string;  // legacy shared secret — now optional (replaced by machine JWT)
  ENVIRONMENT:               string;
  SERVICE_NAME:              string;
  SERVICE_VERSION:           string;
  RATE_LIMIT_KV:             KVNamespace;
  FLAG_CACHE_KV:             KVNamespace;
  OPEN_OBSERVE_API_KEY?:     string;  // OpenObserve ingest key (C-CERT-004)
  OPEN_OBSERVE_ENDPOINT?:    string;  // e.g. https://observe.rald.cloud/api/rald/rald-event-bus/_json
};

export type Variables = {
  db: SupabaseClient;
};

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// ── Health bypass — MUST be FIRST, before all middleware ──────────────────────
// Health / readiness probes must always return 200 regardless of whether
// runtime secrets are provisioned. The boot validation below returns 503 if any
// required env var is missing — without this bypass that 503 hits health probes
// too, making the service appear down even when the worker itself is running.
// G.14 pattern: same fix applied to rald-inbox, rald-notify, rald-search,
// rald-auth-core during the G.14 infrastructure hardening sprint.
app.get("/health",  (c) => c.json({
  status:      "ok",
  service:     "rald-event-bus",
  version:     c.env.SERVICE_VERSION ?? "1.0.0",
  environment: c.env.ENVIRONMENT     ?? "production",
  timestamp:   new Date().toISOString(),
}));
app.get("/healthz", (c) => c.json({ status: "ok", service: "rald-event-bus", timestamp: new Date().toISOString() }));
app.get("/readyz",  (c) => c.json({ status: "ok", service: "rald-event-bus", timestamp: new Date().toISOString() }));

// ── Security headers ──────────────────────────────────────────────────────────
app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  c.header("Referrer-Policy", "no-referrer");
});

// ── Request logger — OpenObserve log shipping ────────────────────────────────
app.use("*", requestLogger("rald-event-bus"));

// ── CORS — internal RALD services only ───────────────────────────────────────
app.use("*", cors({
  origin: (origin) => {
    const allowed = [
      "https://auth.rald.cloud",
      "https://loop-api.rald.cloud",
      "https://chat.rald.cloud",
      "https://notification.rald.cloud",
      "https://realtime.rald.cloud",
      "https://inbox.rald.cloud",
      "https://search.rald.cloud",
      "https://config.rald.cloud",
      "https://control.rald.cloud",
    ];
    return allowed.includes(origin ?? "") ? origin : null;
  },
  allowMethods:  ["GET", "POST", "DELETE", "OPTIONS"],
  allowHeaders:  ["Content-Type", "Authorization", "X-Internal-Secret", "X-Source-Service"],
  exposeHeaders: ["X-RALD-Event-ID", "X-RALD-Request-ID"],
}));

// ── Boot validation ────────────────────────────────────────────────────────────
// RALD_INTERNAL_SECRET is a legacy shared secret — now optional (replaced by machine JWT).
// Only the three core secrets are required for the service to function.
app.use("*", async (c, next) => {
  const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "RALD_JWT_SECRET"];
  for (const key of required) {
    if (!c.env[key as keyof Bindings]) {
      return c.json({ error: `Missing required env: ${key}` }, 503);
    }
  }
  const db = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  c.set("db", db);
  return next();
});

// ── Routes ────────────────────────────────────────────────────────────────────
// Note: /health, /healthz, /readyz are handled above (before middleware).
// healthRoutes also exports /health but it will never be reached for those
// paths since the early handlers above match first.
app.route("/", healthRoutes);
app.route("/", eventsRoutes);
app.route("/", subscriptionRoutes);
app.route("/", auditStreamRoutes);

app.notFound((c) => c.json({ error: "Not found" }, 404));
app.onError((err, c) => {
  console.error("[event-bus] unhandled error:", err);
  return c.json({ error: "Internal server error" }, 500);
});

export default app;
