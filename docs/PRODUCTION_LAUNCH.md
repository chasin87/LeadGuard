# Production launch

This is the operational checklist for a paid v1. LeadGuard does not auto-deploy or create live Stripe charges from this repository.

## Infrastructure

- Canonical `APP_URL` on HTTPS (no localhost leakage in production env)
- DNS to the reverse proxy
- TLS at the proxy (or managed load balancer)
- Nginx (or equivalent): `X-Forwarded-Proto` / `X-Forwarded-For`, large enough `client_max_body_size` for outcome CSV/XLSX, **do not** buffer/rewrite the raw Stripe webhook body
- PostgreSQL 16+ with backups and a tested restore
- Private artifact storage (`ARTIFACT_STORAGE_DRIVER=s3`) with backup/retention
- PM2 or systemd processes (no extra billing worker):

```text
leadguard-web               → next start
leadguard-scheduler         → npm run scheduler
leadguard-worker            → npm run worker
leadguard-browser-worker    → npm run worker:browser
leadguard-notification-worker → npm run worker:notifications
leadguard-google-ads-worker → npm run worker:google-ads
```

Run `prisma migrate deploy` **before** starting app/workers that use new models.

Suggested PM2 apps match [Development](DEVELOPMENT.md). Heartbeats are stored in `WorkerHeartbeat`. Queue backlog can be inspected from `pgboss.job` or `/platform-admin/operations` (platform RBAC).

## Platform admin

Bootstrap the first SUPER_ADMIN after a normal user exists:

```bash
npm run platform-admin:grant -- --email ops@example.com --role SUPER_ADMIN --reason "production bootstrap" --confirm
```

Do not seed default credentials. Put `/platform-admin` behind Cloudflare Access, a VPN, or an IP allowlist in addition to app authorization. See [Platform admin](PLATFORM_ADMIN.md).

## Google

- OAuth web client, redirect `{APP_URL}/api/integrations/google-ads/callback`
- Ads API developer token
- Data Manager uses the same OAuth client; fake provider forbidden in production
- `CREDENTIAL_ENCRYPTION_KEY` 32-byte hex or base64, unique, not the dev fallback

## Stripe

Configure in the Stripe Dashboard (not from this repo):

- Live products/prices for STARTER / GROWTH / PRO / AGENCY (monthly)
- Live secret key + webhook endpoint `https://{APP_URL}/api/billing/stripe/webhook`
- Events listed in [Billing](BILLING.md)
- Customer Portal (payment method, invoices, cancellation; optional plan switching)
- Checkout success/cancel URLs are created server-side
- Tax/VAT if the company needs it — outside this codebase
- Terms / Privacy / cancellation URLs via `BILLING_*_URL`

Copy Price IDs into `STRIPE_PRICE_*_MONTHLY`. Commercial euro amounts are **not** encoded as source of truth.

## Email

- SMTP, `EMAIL_FROM`
- SPF, DKIM, DMARC at the DNS/mail provider
- Stripe already sends invoices; LeadGuard does not duplicate billing mail in v1
- Password reset uses the same email provider

## Workers

Scheduler also runs billing reconciliation. Heartbeats: `SCHEDULER`, `HTTP`, `BROWSER`, `NOTIFICATION`, `GOOGLE_ADS`. Stale workers are an internal signal, not an OWNER UI.

## Security

- Unique `AUTH_SECRET` (≥32) and encryption key; no example secrets
- `BILLING_PROVIDER=fake` and `GOOGLE_ADS_PROVIDER=fake` fail in production
- CSP/HSTS/`X-Content-Type-Options`/`Referrer-Policy`/`frame-ancestors` in `next.config.ts`
- Checkout/Portal are Stripe-hosted redirects (`form-action` allows Stripe)
- Webhook signature required; billing mutations are org-scoped server actions (CSRF via Next)
- Rate limits: login/register, Checkout, Portal, billing refresh, website create
- Fake provider HTTP routes 404 unless the fake provider is selected

## Validation

```text
backup
↓
deploy code compatible with the migration
↓
prisma migrate deploy
↓
restart app/workers
↓
npm run launch:check
↓
GET /api/health and /api/ready
```

`npm run launch:check` only inspects configuration. It does not charge cards, call Google, or send mail.

## Smoke test (staging / Stripe test mode)

```text
register/login
↓
organization (trial)
↓
website
↓
monitor
↓
check
↓
notification
↓
optional tracking → Lead → WON → analytics
```

Billing: Stripe **test mode** or the fake provider on staging. Do not use a live charge as the default smoke test.

## Backup

Confirm Postgres backup + restore and private artifact retention before launch. This repo does not implement a backup engine.
