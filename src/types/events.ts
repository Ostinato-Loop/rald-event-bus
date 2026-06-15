// RALD Event Bus — Canonical Event Types v1.1.0
// PayRald V1: merchant payments, vouchers, settlements, risk, wallet events added.
// LILCKY STUDIO LIMITED

export type EventStatus = "pending" | "delivered" | "failed" | "dead_letter";

export type RaldEventType =
  // ── Identity & Auth ─────────────────────────────────────────────────────────
  | "user.created"
  | "user.verified"
  | "user.suspended"
  | "user.unsuspended"
  | "user.deleted"
  | "username.claimed"
  | "username.changed"
  | "username.released"
  | "username.transferred"
  | "email.verified"
  | "phone.verified"
  | "trust_level.changed"
  // ── Session ─────────────────────────────────────────────────────────────────
  | "session.created"
  | "session.revoked"
  | "session.revoked_all"
  | "device.added"
  | "device.removed"
  | "device.trusted"
  // ── Loop (Audio Platform) ────────────────────────────────────────────────────
  | "room.created"
  | "room.ended"
  | "room.joined"
  | "room.left"
  | "community.created"
  | "community.joined"
  | "community.left"
  | "follow.created"
  | "follow.removed"
  // ── Messenger ────────────────────────────────────────────────────────────────
  | "conversation.created"
  | "message.sent"
  | "call.started"
  | "call.ended"
  // ── Business ─────────────────────────────────────────────────────────────────
  | "business.created"
  | "business.verified"
  // ── Developer ────────────────────────────────────────────────────────────────
  | "developer.registered"
  | "developer.approved"
  | "api_key.created"
  | "api_key.revoked"
  | "app.registered"
  | "webhook.registered"
  // ── Platform ─────────────────────────────────────────────────────────────────
  | "country.activated"
  | "country.restricted"
  | "feature_flag.changed"
  | "kill_switch.activated"
  | "kill_switch.deactivated"
  // ── Notifications ────────────────────────────────────────────────────────────
  | "notification.sent"
  | "notification.delivered"
  | "notification.failed"
  // ── Payments — general ────────────────────────────────────────────────────────
  | "payment.initiated"
  | "payment.completed"
  | "payment.failed"
  | "payment.reversed"
  // ── Transfers ────────────────────────────────────────────────────────────────
  | "transfer.created"
  | "transfer.initiated"
  | "transfer.completed"
  | "transfer.failed"
  | "transfer.reversed"
  // ── Withdrawals ──────────────────────────────────────────────────────────────
  | "withdrawal.created"
  | "withdrawal.initiated"
  | "withdrawal.completed"
  | "withdrawal.failed"
  | "withdrawal.reversed"
  // ── Wallet ───────────────────────────────────────────────────────────────────
  | "wallet.funded"
  | "wallet.credited"
  | "wallet.debited"
  | "wallet.frozen"
  | "wallet.unfrozen"
  | "wallet.provisioned"
  | "wallet.limit_updated"
  // ── Merchant Payments ────────────────────────────────────────────────────────
  | "merchant.payment"
  | "merchant.payment_failed"
  | "merchant.refund"
  | "merchant.onboarded"
  | "merchant.verified"
  | "merchant.suspended"
  // ── Vouchers ─────────────────────────────────────────────────────────────────
  | "voucher.issued"
  | "voucher.redeemed"
  | "voucher.expired"
  | "voucher.refunded"
  // ── Settlement ───────────────────────────────────────────────────────────────
  | "settlement.initiated"
  | "settlement.completed"
  | "settlement.failed"
  | "settlement.batch_created"
  | "settlement.batch_completed"
  // ── Risk & Fraud ─────────────────────────────────────────────────────────────
  | "risk.flagged"
  | "risk.resolved"
  | "risk.escalated"
  | "fraud.detected"
  | "fraud.blocked"
  // ── Alias / ALIA ─────────────────────────────────────────────────────────────
  | "alias.registered"
  | "alias.updated"
  | "alias.deactivated"
  | "alias.resolved";

export interface RaldEvent {
  event_id:    string;
  event_type:  RaldEventType;
  source:      string;
  user_id?:    string;
  actor_id?:   string;
  payload:     Record<string, unknown>;
  metadata:    Record<string, unknown>;
  created_at:  string;
  environment: "production" | "staging" | "development";
}

export interface EventSubscription {
  subscription_id: string;
  service_name:    string;
  event_types:     RaldEventType[];
  endpoint_url:    string;
  secret:          string;
  active:          boolean;
  created_at:      string;
}

export interface PublishEventRequest {
  event_type:  RaldEventType;
  source:      string;
  user_id?:    string;
  actor_id?:   string;
  payload:     Record<string, unknown>;
  metadata?:   Record<string, unknown>;
}
