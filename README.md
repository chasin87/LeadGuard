# LeadGuard

LeadGuard wordt een multi-tenant SaaS-platform dat bedrijven beschermt tegen verspild advertentiebudget en gemiste leads. Deze repository bevat **fase 12: Google Ads Spend-at-Risk & Incident Impact**. Revenue attribution, GCLID-capture, CRM en billing horen bij latere fasen.

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

Zes processen (aparte terminals):

```bash
npm run dev                   # web UI — http://localhost:3000
npm run scheduler             # plant due monitors en Google Ads syncs
npm run worker                # voert HTTP- en AD_DESTINATION-checks uit
npm run worker:browser        # Playwright browser- én form-checks
npm run worker:notifications  # outbox dispatcher + email/webhook delivery
npm run worker:google-ads     # Google Ads destination sync + incident impact (read-only)
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
npm run test:e2e
```

## Projectindeling

- `src/app` — Next.js App Router
- `src/server/monitoring` — HTTP engine, classificatie, scheduler, worker-runner
- `src/server/notifications` — outbox, channels, email/webhook delivery
- `src/jobs` — pg-boss queue
- `src/workers` — proces-entries voor scheduler en workers
- `docs/FORM_MONITORING.md` — echte lead submissions, consent, retry-safety
- `docs/LEAD_RECEIPT_VERIFICATION.md` — downstream e-mail/webhook-ontvangst
- `docs/BROWSER_MONITORING.md` — Playwright, SSRF, screenshots, isolation
- `docs/MONITORING.md` — scheduler, queue, SSRF, redirects
- `docs/SOFT404.md` — heuristische 200-foutpagina detectie
- `docs/INCIDENTS.md` — failure threshold, lifecycle, health
- `docs/NOTIFICATIONS.md` — outbox, channels, retries, signing

Zie [Development](docs/DEVELOPMENT.md), [Architecture](docs/ARCHITECTURE.md), [Security](docs/SECURITY.md), [Monitoring](docs/MONITORING.md), [Browser monitoring](docs/BROWSER_MONITORING.md), [Form monitoring](docs/FORM_MONITORING.md), [Lead receipt verification](docs/LEAD_RECEIPT_VERIFICATION.md), [Soft-404](docs/SOFT404.md), [Incidents](docs/INCIDENTS.md) en [Notifications](docs/NOTIFICATIONS.md).
