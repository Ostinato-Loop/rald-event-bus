// RALD Event Bus — Identity Provisioning Chain
// Handles: identity.created → wallet + alias + mailbox + messenger
//
// Flow:
//   POST /internal/provision-identity  (called by event fan-out or directly by rald-identity)
//     1. POST core.pay.rald.cloud/wallets/provision    → wallet created
//     2. POST routing.rald.cloud/aliases/provision     → ALIA alias created  (e.g. boyd@rald)
//     3. POST notify.rald.cloud/mailboxes/provision    → mailbox created
//     4. POST messenger.rald.cloud/accounts/provision  → messenger account
//     5. Emit identity.provisioned event
//
// All steps are fire-and-forget with retries via DLQ on failure.
// LILCKY STUDIO LIMITED

import { Hono } from "hono";
import type { Bindings, Variables } from "../index";
import { requireMachineAuth } from "../lib/machine-auth";
import { writeAuditLog } from "../lib/audit";

const identity = new Hono<{ Bindings: Bindings; Variables: Variables }>();

interface IdentityCreatedPayload {
  user_id: string;
  rald_id: string;
  name: string;
  email?: string;
  phone?: string;
  kyc_tier?: number;
}

interface ProvisionResult {
  step: string;
  ok: boolean;
  error?: string;
}

async function provisionStep(
  url: string,
  payload: Record<string, unknown>,
  secret: string,
  step: string,
): Promise<ProvisionResult> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Secret": secret,
        "X-Source-Service": "rald-event-bus",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { step, ok: false, error: `HTTP ${res.status}: ${body.slice(0, 120)}` };
    }
    return { step, ok: true };
  } catch (err) {
    return { step, ok: false, error: String(err) };
  }
}

// POST /internal/provision-identity
// Called by event bus fan-out for identity.created events.
identity.post("/internal/provision-identity", requireMachineAuth("events:write"), async (c) => {
  const db = c.get("db");
  const secret = c.env.RALD_INTERNAL_SECRET ?? c.env.RALD_JWT_SECRET;

  const body = await c.req.json<IdentityCreatedPayload>().catch(() => null);
  if (!body?.user_id || !body?.rald_id) {
    return c.json({ error: "user_id and rald_id are required" }, 400);
  }

  const { user_id, rald_id, name, email, phone, kyc_tier = 1 } = body;

  // Run all 4 provisioning steps concurrently
  const results = await Promise.allSettled([
    // 1. Wallet provisioning
    provisionStep(
      `${c.env.PAYRALD_CORE_URL ?? "https://core.pay.rald.cloud"}/wallets/provision`,
      { user_id, rald_id, name, email, phone, kyc_tier, currency: "NGN" },
      secret,
      "wallet",
    ),
    // 2. ALIA alias provisioning (creates rald_id@rald)
    provisionStep(
      `${c.env.ROUTING_URL ?? "https://routing.rald.cloud"}/aliases/provision`,
      { user_id, alias: `${rald_id}@rald`, alias_type: "personal", display_name: name },
      secret,
      "alias",
    ),
    // 3. Mailbox provisioning
    provisionStep(
      `${c.env.NOTIFY_URL ?? "https://notify.rald.cloud"}/mailboxes/provision`,
      { user_id, rald_id, name, email },
      secret,
      "mailbox",
    ),
    // 4. Messenger account provisioning
    provisionStep(
      `${c.env.MESSENGER_URL ?? "https://messenger.rald.cloud"}/accounts/provision`,
      { user_id, rald_id, display_name: name, avatar_seed: user_id },
      secret,
      "messenger",
    ),
  ]);

  const steps: ProvisionResult[] = results.map((r, i) => {
    const labels = ["wallet", "alias", "mailbox", "messenger"];
    if (r.status === "fulfilled") return r.value;
    return { step: labels[i], ok: false, error: String(r.reason) };
  });

  const allOk = steps.every((s) => s.ok);
  const failedSteps = steps.filter((s) => !s.ok).map((s) => s.step);

  // Emit identity.provisioned event (or identity.provision_partial on partial failure)
  const eventType = allOk ? "identity.provisioned" : "identity.provision_partial";
  await db.from("event_log").insert({
    event_id:    crypto.randomUUID(),
    event_type:  eventType,
    source:      "rald-event-bus",
    user_id,
    payload:     { rald_id, steps, failed_steps: failedSteps },
    environment: c.env.ENVIRONMENT ?? "production",
    status:      allOk ? "delivered" : "partial",
    created_at:  new Date().toISOString(),
  });

  // If any steps failed, push to DLQ for retry
  if (!allOk) {
    await db.from("event_dlq").insert(
      failedSteps.map((step) => ({
        id:          crypto.randomUUID(),
        event_type:  "identity.created",
        source:      "rald-event-bus",
        payload:     { ...body, failed_step: step },
        error:       `Provisioning step failed: ${step}`,
        retry_count: 0,
        created_at:  new Date().toISOString(),
      }))
    );
  }

  await writeAuditLog(db, {
    action: eventType,
    service: "rald-event-bus",
    userId: user_id,
    status: allOk ? "success" : "warning",
    severity: allOk ? "info" : "warn",
    metadata: { rald_id, steps, failed_steps: failedSteps },
  });

  return c.json({
    ok: allOk,
    user_id,
    rald_id,
    alias: `${rald_id}@rald`,
    steps,
    event: eventType,
  }, allOk ? 200 : 207);
});

// GET /internal/provision-status/:userId — check provisioning state
identity.get("/internal/provision-status/:userId", requireMachineAuth("events:read"), async (c) => {
  const db = c.get("db");
  const userId = c.req.param("userId");

  const { data: events } = await db
    .from("event_log")
    .select("event_type, payload, created_at")
    .eq("user_id", userId)
    .in("event_type", ["identity.created", "identity.provisioned", "identity.provision_partial"])
    .order("created_at", { ascending: false })
    .limit(10);

  return c.json({ user_id: userId, events: events ?? [] });
});

export default identity;
