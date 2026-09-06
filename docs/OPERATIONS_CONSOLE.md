# Operations console

Internal operators use `/platform-admin/operations` (platform RBAC required).

## Workers

Heartbeats from:

```text
SCHEDULER
HTTP
BROWSER
NOTIFICATION
GOOGLE_ADS
```

Health is derived from `lastSeenAt`:

- HEALTHY ≤ 2 minutes
- DEGRADED ≤ 5 minutes
- STALE afterwards

No live provider poll on every pageview.

## Queues

Summaries show pending / running / failed counts and oldest pending age. Job payloads are not displayed (they can contain IDs, secrets, click identifiers, or revenue).

Retries are mapped to existing services:

- `monitor.check` / `monitor.browser.check` → enqueue with singleton key
- `google_ads.conversion.submit` / `.status` → `retryConversionExportRecord` (no duplicate succeeded conversion)

Unknown queues cannot be mutated from the UI.

## System health

Configured flags only: web, database, Stripe provider kind, email SMTP present, storage driver, Google client id/secret present. Values and secrets are never shown.
