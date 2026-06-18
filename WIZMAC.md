# WIZMAC — rald-event-bus
> RALD Event Bus — Async Event Fan-out Engine
> Last updated: 2026-06-17 — LILCKY STUDIO LIMITED

---

## 1. Product Overview
**rald-event-bus** is the async messaging backbone of the RALD ecosystem. It receives events published by any service and delivers them to all registered subscribers. It powers the identity provisioning chain, audit logging, and cross-product notifications.

| Field | Value |
|-------|-------|
| Live URL | `https://events.rald.cloud` |
| Repo | `Ostinato-Loop/rald-event-bus` |
| Stack | Cloudflare Worker (Hono) |
| Database | Supabase `onxdcikfttdmnhofsuwo.supabase.co` |
| Version | 2.1.0 |

---

## 2. Architecture
| Layer | Stack | Deployment |
|-------|-------|------------|
| Event Receiver | Cloudflare Worker | `events.rald.cloud` |
| Fan-out | Synchronous HTTP to subscribers | Via `event_subscriptions` table |
| Dead Letter | `event_log` status = dead_lettered | After 3 retry attempts |
| Audit Stream | `audit_stream` table | Immutable audit log |

---

## 3. Event Flow
```
1. Producer calls: POST /publish { event_type, source, user_id, payload }
2. Event bus inserts into event_log (status=pending)
3. Queries event_subscriptions WHERE event_type = ANY(event_types)
4. Fan-out: POST to each subscriber endpoint (HMAC signed)
5. On success: event_log status=delivered
6. On failure: retry up to 3x, then status=dead_lettered
7. Publishes identity.provisioned when chain completes
```

---

## 4. Database Schema
```sql
event_log (
  id UUID, event_id TEXT UNIQUE, event_type TEXT, source TEXT,
  user_id UUID, actor_id UUID, payload JSONB, metadata JSONB,
  environment TEXT, status TEXT, delivered_at TIMESTAMPTZ,
  retry_count INT, created_at TIMESTAMPTZ
)

event_subscriptions (
  subscription_id UUID, service_name TEXT, event_types TEXT[],
  endpoint_url TEXT, secret TEXT, active BOOLEAN,
  created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ,
  UNIQUE(service_name, endpoint_url)
)

event_deliveries (
  delivery_id UUID, event_id TEXT, subscription_id UUID,
  attempt INT, status TEXT, response_code INT,
  response_body TEXT, delivered_at TIMESTAMPTZ, error TEXT
)

audit_stream (
  id UUID, event_type TEXT, actor TEXT, resource_type TEXT,
  resource_id TEXT, action TEXT, metadata JSONB,
  ip_address TEXT, created_at TIMESTAMPTZ
)
```

---

## 5. Key Environment Variables
| Variable | Required | Set In |
|----------|----------|--------|
| `SUPABASE_URL` | ✅ | Cloudflare secret |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ ⚠️ ROTATE | Cloudflare secret |
| `RALD_INTERNAL_SECRET` | ✅ | Cloudflare secret |
| `RALD_JWT_SECRET` | ✅ | Cloudflare secret |
| `MACHINE_IDENTITY_SECRET` | ✅ | Cloudflare secret |
| `ENVIRONMENT` | ✅ | `production` |

---

## 6. Live Endpoints
| Method | Path | Auth | Status |
|--------|------|------|--------|
| GET | `/health` | None | ✅ |
| POST | `/publish` | Machine JWT or `X-Internal-Secret` | ✅ |
| POST | `/internal/provision-identity` | `X-Internal-Secret` or HMAC | ✅ |
| GET | `/subscriptions` | Admin JWT | ✅ |
| POST | `/subscriptions` | Admin JWT | ✅ |
| GET | `/events` | Admin JWT | ✅ |

---

## 7. Seed SQL (MUST RUN)
```sql
-- Wire identity.created → provisioning chain
-- File: scripts/seed-subscriptions.sql
-- ⚠️ Replace REPLACE_WITH_RALD_INTERNAL_SECRET before running
```

---

## 8. CI Pipelines
| Workflow | Trigger | Status |
|----------|---------|--------|
| CI | Push/PR to main | ✅ Green |
| Deploy | Push to main | ✅ Green |

---

## 9. Incidents
| # | Date | Description | Status |
|---|------|-------------|--------|
| EB-001 | 2026-06-17 | event_subscriptions table not seeded — identity.created fan-out never triggered | ⚠️ SQL ready, pending execution |
| EB-002 | 2026-06-17 | rald_alias_registry missing — alias provision would fail | ✅ Added to seed SQL |
