// RALD Event Bus — Canonical Event Types
// Every major ecosystem action emits one of these events.
// Consumers register to receive specific event types.
// LILCKY STUDIO LIMITED

export type EventStatus = "pending" | "delivered" | "failed" | "dead_letter";

export type RaldEventType =
  // Identity & Auth
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
  // Session
  | "session.created"
  | "session.revoked"
  | "session.revoked_all"
  | "device.added"
  | "device.removed"
  | "device.trusted"
  // Loop (Audio Platform)
  | "room.created"
  | "room.ended"
  | "room.joined"
  | "room.left"
  | "community.created"
  | "community.joined"
  | "community.left"
  | "follow.created"
  | "follow.removed"
  // Messenger
  | "conversation.created"
  | "message.sent"
  | "call.started"
  | "call.ended"
  // Business
  | "business.created"
  | "business.verified"
  // Developer
  | "developer.registered"
  | "developer.approved"
  | "api_key.created"
  | "api_key.revoked"
  | "app.registered"
  | "webhook.registered"
  // Platform
  | "country.activated"
  | "country.restricted"
  | "feature_flag.changed"
  | "kill_switch.activated"
  | "kill_switch.deactivated"
  // Notifications
  | "notification.sent"
  | "notification.delivered"
  | "notification.failed"
  // Payments (future)
  | "payment.initiated"
  | "payment.completed"
  | "payment.failed";

export interface RaldEvent {
  event_id:    string;
  event_type:  RaldEventType;
  source:      string;        // originating service (e.g. "rald-auth-core", "loop-api")
  user_id?:    string;        // subject user (if applicable)
  actor_id?:   string;        // user who triggered the action (may differ from subject)
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
  secret:          string;   // HMAC secret for payload signature verification
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
