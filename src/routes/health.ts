// RALD Event Bus — Health Route
// LILCKY STUDIO LIMITED
import { Hono } from "hono";
import type { Bindings, Variables } from "../index";

const health = new Hono<{ Bindings: Bindings; Variables: Variables }>();

health.get("/health", (c) =>
  c.json({
    status:      "ok",
    service:     "rald-event-bus",
    version:     c.env.SERVICE_VERSION ?? "1.0.0",
    environment: c.env.ENVIRONMENT,
    timestamp:   new Date().toISOString(),
  })
);

export default health;
