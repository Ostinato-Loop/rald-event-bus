// RALD Event Bus — Machine Identity Middleware
// Sprint: Operator Platform Phase 9 · 2026-06-12
// Replaces ad-hoc RALD_INTERNAL_SECRET check with machine JWT verification.
// Machine JWTs are issued by rald-auth-core POST /machine/auth.
// Backward-compatible: falls back to X-Internal-Secret during transition window.
// LILCKY STUDIO LIMITED

import type { Context, Next } from "hono";
import type { Bindings, Variables } from "../index";

export interface MachineJwtPayload {
  type:             "machine";
  machine_id:       string;
  service_name:     string;   // e.g. "rald-loop-api", "rald-messenger"
  scopes:           string[]; // e.g. ["events:write", "audit:write"]
  allowed_services: string[]; // which target services this machine key can call
  iat:              number;
  exp:              number;
}

// ── JWT verification (HMAC-SHA256, same as user JWT) ─────────────────────────
async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["verify"]
  );
}

async function verifyMachineJwt(
  token: string,
  secret: string
): Promise<MachineJwtPayload | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts as [string, string, string];
    const key = await hmacKey(secret);
    const sigBytes = Uint8Array.from(
      atob(sig.replace(/-/g, "+").replace(/_/g, "/")),
      (c) => c.charCodeAt(0)
    );
    const valid = await crypto.subtle.verify(
      "HMAC", key, sigBytes,
      new TextEncoder().encode(`${header}.${body}`)
    );
    if (!valid) return null;
    const payload = JSON.parse(
      atob(body.replace(/-/g, "+").replace(/_/g, "/"))
    ) as MachineJwtPayload;
    if (payload.type !== "machine") return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

// ── requireMachineAuth — middleware factory ────────────────────────────────────
// Usage: router.post("/audit", requireMachineAuth("audit:write"), handler)
// During the transition window, also accepts X-Internal-Secret for backward compat.
export function requireMachineAuth(requiredScope?: string) {
  return async (
    c: Context<{ Bindings: Bindings; Variables: Variables }>,
    next: Next
  ) => {
    const env = c.env;

    // 1. Try machine JWT first (preferred path)
    const authHeader = c.req.header("Authorization");
    const machineTokenHeader = c.req.header("X-Machine-Token");
    const tokenRaw = machineTokenHeader ??
      (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null);

    if (tokenRaw) {
      const payload = await verifyMachineJwt(tokenRaw, env.RALD_JWT_SECRET);
      if (!payload) {
        return c.json({ error: "Invalid or expired machine token" }, 401);
      }
      // Scope check
      if (requiredScope && !payload.scopes.includes(requiredScope)) {
        return c.json(
          { error: `Machine token missing required scope: ${requiredScope}` },
          403
        );
      }
      // Make payload available to route handler
      c.set("machine" as never, payload as never);
      return next();
    }

    // 2. Backward-compat: X-Internal-Secret (deprecated — remove after all services migrated)
    const internalSecret = c.req.header("X-Internal-Secret");
    if (internalSecret && env.RALD_INTERNAL_SECRET && internalSecret === env.RALD_INTERNAL_SECRET) {
      console.warn(
        "[rald-event-bus] DEPRECATED: X-Internal-Secret used — migrate to machine JWT"
      );
      return next();
    }

    return c.json(
      { error: "Unauthorized — machine token or internal secret required" },
      401
    );
  };
}

// ── requireAdminSecret — for admin-only management routes ─────────────────────
// Uses RALD_ADMIN_SECRET; no JWT needed — admin calls come from control plane only.
export function requireAdminSecret() {
  return async (
    c: Context<{ Bindings: Bindings; Variables: Variables }>,
    next: Next
  ) => {
    const secret = c.req.header("X-Admin-Secret") ?? c.req.header("X-Internal-Secret");
    if (!secret || !c.env.RALD_INTERNAL_SECRET || secret !== c.env.RALD_INTERNAL_SECRET) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    return next();
  };
}
