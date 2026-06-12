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

export type Bindings = {
  SUPABASE_URL:              string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  RALD_JWT_SECRET:           string;
  RALD_INTERNAL_SECRET:      string;  // shared secret for internal service-to-service calls
  ENVIRONMENT:               string;
  SERVICE_NAME:              string;
  SERVICE_VERSION:           string;
  RATE_LIMIT_KV:             KVNamespace;
  FLAG_CACHE_KV:             KVNamespace;
};

export type Variables = {
  db: SupabaseClient;
};

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// ── Security headers ──────────────────────────────────────────────────────────
app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  c.header("Referrer-Policy", "no-referrer");
});

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
app.use("*", async (c, next) => {
  const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "RALD_JWT_SECRET", "RALD_INTERNAL_SECRET"];
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
app.route("/", healthRoutes);
app.route("/", eventsRoutes);
app.route("/", subscriptionRoutes);

app.notFound((c) => c.json({ error: "Not found" }, 404));
app.onError((err, c) => {
  console.error("[event-bus] unhandled error:", err);
  return c.json({ error: "Internal server error" }, 500);
});

export default app;
