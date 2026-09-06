# LeadGuard

LeadGuard wordt een multi-tenant SaaS-platform dat bedrijven beschermt tegen verspild advertentiebudget en gemiste leads. Deze repository bevat **fase 18.1: Platform Admin & Operations Console**. Native CRM-connectors, Meta Ads en AI-optimalisatie horen niet bij v1.

## Vereisten

- Node.js 22 of nieuwer
- npm 10 of nieuwer
- Een lokaal of extern PostgreSQL 16+-instance (Docker is niet nodig)

## Lokaal starten

```bash
npm install
cp -n .env.example .env
# Als .env nieuw is: pas DATABASE_URL aan en zet AUTH_SECRET:
# openssl rand -base64 32
npm run db:generate
npm run db:validate
npm run db:migrate
npm run db:check
```

Alles in één terminal:

```bash
npm run dev:all
```

Dat start web, scheduler, HTTP-worker, browser-worker, notification-worker en Google Ads-worker. `Ctrl+C` stopt ze allemaal. Logs hebben een prefix per proces (`[web]`, `[scheduler]`, …).

Aparte terminals blijven mogelijk:

```bash
npm run dev                   # web UI — http://localhost:3000
npm run scheduler             # plant due monitors en Google Ads syncs
npm run worker                # voert HTTP- en AD_DESTINATION-checks uit
npm run worker:browser        # Playwright browser- én form-checks
npm run worker:notifications  # outbox dispatcher + email/webhook delivery
npm run worker:google-ads     # Google Ads sync, incident impact, conversion ingest/status
```

Lokaal gebruikt Google Ads standaard de fake provider. Productie vereist `GOOGLE_ADS_PROVIDER=google`, OAuth-client, developer token en `CREDENTIAL_ENCRYPTION_KEY`. Zie [Google Ads](docs/GOOGLE_ADS.md).

Zonder scheduler/worker kun je monitors beheren, maar er worden geen automatische checks uitgevoerd. **Run check now** enqueue’t alleen een job; de bijbehorende worker moet draaien om een resultaat te zien. Browserchecks starten nooit in de Next.js-request. Zonder notification-worker openen incidents nog steeds; alerts blijven in de outbox tot de worker draait.

Installeer Chromium eenmalig voor zowel e2e als de browser worker:

```bash
npx playwright install chromium
```

## Kwaliteitscontroles

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run e2e:clean
npm run launch:check
```

## Projectindeling

- `src/app` — Next.js App Router
- `src/server/monitoring` — HTTP engine, classificatie, scheduler, worker-runner
- `src/server/notifications` — outbox, channels, email/webhook delivery
- `src/jobs` — pg-boss queue
- `src/workers` — proces-entries voor scheduler en workers
- `docs/OUTCOME_INGESTION_API.md` — Bearer/HMAC outcome API
- `docs/OUTCOME_IMPORTS.md` — CSV/XLSX import
- `docs/CRM_BRIDGE.md` — generic adapter boundary
- `docs/LEAD_REVENUE_DATA_LAYER.md` — lead status, realized revenue, audit
- `docs/REVENUE_ATTRIBUTION_FOUNDATION.md` — visitor/session/touch/lead attribution
- `docs/TRACKING_SDK.md` — installatie, consent, cookies, CSP
- `docs/FORM_MONITORING.md` — echte lead submissions, consent, retry-safety
- `docs/LEAD_RECEIPT_VERIFICATION.md` — downstream e-mail/webhook-ontvangst
- `docs/BILLING.md` — Stripe Checkout, webhooks, trial, suspension
- `docs/PLANS_AND_ENTITLEMENTS.md` — plan catalog and limits
- `docs/ONBOARDING.md` — first-run activation
- `docs/PRODUCTION_LAUNCH.md` — launch checklist
- `docs/PLATFORM_ADMIN.md` — platform RBAC, bootstrap, `/platform-admin`
- `docs/OPERATIONS_CONSOLE.md` — workers, queues, health
- `docs/BROWSER_MONITORING.md` — Playwright, SSRF, screenshots, isolation
- `docs/MONITORING.md` — scheduler, queue, SSRF, redirects
- `docs/SOFT404.md` — heuristische 200-foutpagina detectie
- `docs/INCIDENTS.md` — failure threshold, lifecycle, health
- `docs/GOOGLE_ADS_CONVERSION_FEEDBACK.md` — Data Manager conversion writes
- `docs/REVENUE_ANALYTICS.md` — acquisition-cohort Real ROAS
- `docs/GOOGLE_ADS_CLICK_ATTRIBUTION.md` — ClickView campaign resolution

Zie [Development](docs/DEVELOPMENT.md), [Architecture](docs/ARCHITECTURE.md), [Security](docs/SECURITY.md), [Platform admin](docs/PLATFORM_ADMIN.md), [Operations console](docs/OPERATIONS_CONSOLE.md), [Billing](docs/BILLING.md), [Plans](docs/PLANS_AND_ENTITLEMENTS.md), [Onboarding](docs/ONBOARDING.md), [Production launch](docs/PRODUCTION_LAUNCH.md), [Monitoring](docs/MONITORING.md), [Browser monitoring](docs/BROWSER_MONITORING.md), [Form monitoring](docs/FORM_MONITORING.md), [Lead receipt verification](docs/LEAD_RECEIPT_VERIFICATION.md), [Revenue attribution](docs/REVENUE_ATTRIBUTION_FOUNDATION.md), [Lead & revenue](docs/LEAD_REVENUE_DATA_LAYER.md), [Revenue analytics](docs/REVENUE_ANALYTICS.md), [Click attribution](docs/GOOGLE_ADS_CLICK_ATTRIBUTION.md), [Outcome ingestion](docs/OUTCOME_INGESTION_API.md), [Outcome imports](docs/OUTCOME_IMPORTS.md), [CRM bridge](docs/CRM_BRIDGE.md), [Tracking SDK](docs/TRACKING_SDK.md), [Soft-404](docs/SOFT404.md), [Incidents](docs/INCIDENTS.md) en [Notifications](docs/NOTIFICATIONS.md).
