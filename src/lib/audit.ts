// RALD Event Bus — Audit Logger
// LILCKY STUDIO LIMITED

import type { SupabaseClient } from "@supabase/supabase-js";

export async function writeAuditLog(
  db: SupabaseClient,
  entry: {
    action: string;
    service?: string;
    user_id?: string;
    ip?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  try {
    await db.from("event_bus_audit_logs").insert({
      action:     entry.action,
      service:    entry.service ?? "rald-event-bus",
      user_id:    entry.user_id ?? null,
      ip:         entry.ip ?? null,
      metadata:   entry.metadata ?? {},
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    console.warn("[audit] write failed:", String(err));
  }
}
