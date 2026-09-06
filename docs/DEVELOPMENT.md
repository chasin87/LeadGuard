# Development

## PostgreSQL zonder Docker

Installeer PostgreSQL 16 of nieuwer via het packagebeheer van je besturingssysteem of gebruik een beheerde developmentdatabase. Maak vervolgens een lokale rol en database aan, bijvoorbeeld in `psql`:

```sql
CREATE ROLE leadguard WITH LOGIN PASSWORD 'kies-een-lokaal-wachtwoord';
CREATE DATABASE leadguard OWNER leadguard;
CREATE DATABASE leadguard_e2e OWNER leadguard;
```

Kopieer `.env.example` alleen naar `.env` als die nog niet bestaat (`cp -n .env.example .env`). Een gewone `cp` overschrijft `AUTH_SECRET` en `DATABASE_URL`. Genereer daarna een Auth-secret:

```bash
openssl rand -base64 32
```

Zet de output in `AUTH_SECRET`. Houd `AUTH_URL` gelijk aan `APP_URL`.

Het repository bevat op verzoek geen Docker- of Docker Compose-configuratie.

De databasegebruiker heeft mogelijk geen recht om een Prisma shadow database aan te maken. Nieuwe migrations worden daarom als SQL onder `prisma/migrations` bewaard en toegepast met `npm run db:migrate` (`prisma migrate deploy`).

## Installatie

```bash
npm install
npm run db:generate
npm run db:validate
npm run db:migrate
npm run db:check
```

`db:check` doet een echte `SELECT 1` en faalt als PostgreSQL niet bereikbaar is.

## Dagelijkse workflow

Start alles in één terminal met `npm run dev:all` (web, scheduler, HTTP-worker, browser-worker, notification-worker, Google Ads-worker). `Ctrl+C` stopt de hele stack. Aparte terminals blijven mogelijk: `npm run dev`, `npm run scheduler`, `npm run worker`, `npm run worker:browser`, `npm run worker:notifications`, `npm run worker:google-ads`. De browser-worker verwerkt zowel BROWSER- als FORM-jobs; HTTP-checks blijven op de HTTP-worker. Voer vóór een commit ten minste formatter, lint, typecheck, unit/integration tests en build uit. De canonieke E2E-gate is `npm run e2e:clean`: die reset alleen de dedicated testdatabase, bouwt `next build`, start een eigen `next start` op poort 3015, draait Playwright met `retries=0` en stopt die server weer. Hergebruik geen handmatige `dev:all`. Installeer de Chromium-binary eenmalig met `npx playwright install chromium`. Die binary gebruikt ook de browser worker.

Handige routes:

- `/register` — account
- `/onboarding` — eerste organisatie
- `/login` — inloggen
- `/app/[slug]/dashboard`
- `/app/[slug]/websites`
- `/app/[slug]/websites/new`
- `/app/[slug]/websites/[websiteId]`
- `/app/[slug]/websites/[websiteId]/settings`
- `/app/[slug]/websites/[websiteId]/monitors/new`
- `/app/[slug]/websites/[websiteId]/monitors/[monitorId]`
- `/app/[slug]/incidents`
- `/app/[slug]/incidents/[incidentId]`
- `/app/[slug]/settings`
- `/app/[slug]/settings/members`
- `/app/[slug]/settings/notifications`
- `/app/[slug]/integrations`
- `/app/[slug]/integrations/google-ads`
- `/app/[slug]/integrations/outcomes`
- `/app/[slug]/attribution`
- `/platform-admin` — internal operators only

Website-URL's zijn origins. Monitor-URL's mogen paden hebben op dezelfde host. Alleen poort 80/443. HTTP-minimum interval 5 minuten, browser 10 minuten, form 1 uur. Incident-threshold default 2. Zie [Monitoring](MONITORING.md), [Form monitoring](FORM_MONITORING.md), [Soft-404](SOFT404.md), [Incidents](INCIDENTS.md), [Google Ads](GOOGLE_ADS.md), [incident impact](GOOGLE_ADS_INCIDENT_IMPACT.md) en [Lead & revenue](LEAD_REVENUE_DATA_LAYER.md).

Productieprocessen (documentatie, geen deployment in deze fase):

```text
leadguard-web        → next start
leadguard-scheduler  → npm run scheduler
leadguard-worker     → npm run worker
```

PM2-voorbeeld:

```javascript
module.exports = {
  apps: [
    {
      name: "leadguard-web",
      script: "node_modules/next/dist/bin/next",
      args: "start",
    },
    { name: "leadguard-scheduler", script: "npm", args: "run scheduler" },
    {
      name: "leadguard-worker",
      script: "npm",
      args: "run worker",
      instances: 2,
    },
    {
      name: "leadguard-browser-worker",
      script: "npm",
      args: "run worker:browser",
      instances: 1,
    },
    {
      name: "leadguard-notification-worker",
      script: "npm",
      args: "run worker:notifications",
    },
    {
      name: "leadguard-google-ads-worker",
      script: "npm",
      args: "run worker:google-ads",
    },
  ],
};
```

systemd: vijf units met dezelfde commands, `Restart=on-failure`, en `KillSignal=SIGTERM` zodat workers/scheduler netjes stoppen. Geen Docker Compose in deze repo.

## Linux / Chromium

De Browser Worker heeft Playwright Chromium nodig (`npx playwright install chromium` plus OS-dependencies, zie Playwright docs voor Ubuntu). Draai de worker **niet als root**. Laat de Chromium-sandbox aan (`PLAYWRIGHT_CHROMIUM_SANDBOX=true`) tenzij de container dat onmogelijk maakt; documenteer dan `--no-sandbox` als risico en isoleer het netwerk extra. Verwacht enkele honderden MB RAM per Chromium plus page; default concurrency is 2.

Screenshots: `ARTIFACT_STORAGE_DRIVER=local` voor development (paden komen niet in de publieke UI). Productie: S3-compatible bucket, private, geen public-read.

De Browser Worker mag outbound internet, maar moet op firewall/container-niveau **geen** toegang hebben tot metadata-IPs (`169.254.169.254`), RFC1918, localhost-services en interne adminnetwerken.

## Tests

```bash
npm test          # Vitest: unit + integration (echte PostgreSQL)
npm run e2e:clean # Playwright vanaf schone testdatabase, retries=0
```

`npm run test:e2e` is hetzelfde als `e2e:clean`. De suite reset nooit `leadguard` (development) of een productiedatabase: de database-naam moet `leadguard_e2e` / `leadguard_test` bevatten of op `_e2e`/`_test` eindigen, plus `ALLOW_E2E_DB_RESET=true`. Playwright start `next start` op `127.0.0.1:3015` en hergebruikt geen bestaande server. E2E zet `BILLING_PROVIDER=fake` en gebruikt geen live Stripe.

`npm run launch:check` valideert productieconfiguratie zonder side effects. Zie [Production launch](PRODUCTION_LAUNCH.md).

Integration tests schrijven tijdelijke users/organizations en ruimen die daarna op. Ze vereisen een werkende `DATABASE_URL` en `AUTH_SECRET`.

## Environment

| Variabele                                   | Vereist | Omschrijving                                                                                                    |
| ------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                              | Ja      | PostgreSQL connection string; alleen server-side                                                                |
| `AUTH_SECRET`                               | Ja      | Auth.js signing secret, minimaal 32 tekens                                                                      |
| `APP_URL`                                   | Nee     | Publieke applicatie-origin, standaard lokaal                                                                    |
| `AUTH_URL`                                  | Nee     | Canonical Auth.js URL; gelijk houden aan `APP_URL`                                                              |
| `AUTH_TRUST_HOST`                           | Nee     | `true` achter een reverse proxy met `X-Forwarded-*`                                                             |
| `LOG_LEVEL`                                 | Nee     | `debug`, `info`, `warn` of `error`                                                                              |
| `MONITOR_WORKER_CONCURRENCY`                | Nee     | Gelijktijdige jobs per worker, default 5                                                                        |
| `MONITOR_DEFAULT_INTERVAL_SECONDS`          | Nee     | Default 300                                                                                                     |
| `MONITOR_MIN_INTERVAL_SECONDS`              | Nee     | Minimum 300                                                                                                     |
| `MONITOR_DEFAULT_TIMEOUT_MS`                | Nee     | Default 10000                                                                                                   |
| `MONITOR_MAX_TIMEOUT_MS`                    | Nee     | Maximum 30000                                                                                                   |
| `MONITOR_MAX_REDIRECTS`                     | Nee     | Default 10                                                                                                      |
| `SMTP_HOST`                                 | Nee     | SMTP hostname; leeg = console in development                                                                    |
| `SMTP_PORT`                                 | Nee     | Default 587, of 465 bij `SMTP_SECURE=true`                                                                      |
| `SMTP_SECURE`                               | Nee     | `true` voor TLS-on-connect                                                                                      |
| `SMTP_USER` / `SMTP_PASSWORD`               | Nee     | SMTP-auth; nooit committen                                                                                      |
| `EMAIL_FROM`                                | Nee     | From-header; verplicht voor echte SMTP-sends                                                                    |
| `NOTIFICATION_WORKER_CONCURRENCY`           | Nee     | Gelijktijdige notification jobs, default 5                                                                      |
| `INBOUND_EMAIL_PROVIDER`                    | Nee     | `generic` of `dev` (dev nooit in productie)                                                                     |
| `INBOUND_EMAIL_DOMAIN`                      | Nee     | Domain voor `receipt+id@domain`; leeg = mode uit                                                                |
| `INBOUND_EMAIL_WEBHOOK_SECRET`              | Nee     | Minimaal 32 tekens; HMAC/Bearer voor inbound POST                                                               |
| `RECEIPT_DEFAULT_TIMEOUT_MINUTES`           | Nee     | Default 15, bereik 1–120                                                                                        |
| `RECEIPT_MAX_TIMEOUT_MINUTES`               | Nee     | Maximum 120                                                                                                     |
| `GOOGLE_ADS_PROVIDER`                       | Nee     | `fake` (dev/test) of `google`; fake verboden in prod                                                            |
| `GOOGLE_ADS_CLIENT_ID` / `_SECRET`          | Nee     | OAuth web client; vereist voor live Google                                                                      |
| `GOOGLE_ADS_DEVELOPER_TOKEN`                | Nee     | Platform developer token; nooit per klant                                                                       |
| `GOOGLE_ADS_REDIRECT_URI`                   | Nee     | Default `{APP_URL}/api/integrations/google-ads/callback`                                                        |
| `CREDENTIAL_ENCRYPTION_KEY`                 | Nee*    | 32-byte AES key (hex/base64); verplicht voor live Google; tracking click IDs gebruiken een HKDF-derived context |
| `TRACKING_PUBLIC_BASE_URL`                  | Nee     | Publieke origin voor het SDK-snippet; default `APP_URL`                                                         |
| `TRACKING_DEFAULT_ATTRIBUTION_WINDOW_DAYS`  | Nee     | Default 90, bereik 1–365                                                                                        |
| `TRACKING_DEFAULT_SESSION_TIMEOUT_MINUTES`  | Nee     | Default 30, bereik 5–240                                                                                        |
| `TRACKING_EVENT_RATE_LIMIT`                 | Nee     | Publieke events per minuut per siteKey+origin+IP, default 60                                                    |
| `OUTCOME_API_RATE_LIMIT`                    | Nee     | Outcome events per minuut per credential, default 300                                                           |
| `OUTCOME_ORG_RATE_LIMIT`                    | Nee     | Outcome events per minuut per organization, default 600                                                         |
| `OUTCOME_IP_RATE_LIMIT`                     | Nee     | Outcome events per minuut per IP, default 120                                                                   |
| `BILLING_PROVIDER`                          | Nee     | `fake` (dev/e2e) of `stripe`; fake verboden in productie                                                        |
| `STRIPE_SECRET_KEY`                         | Nee*    | Server-only; `sk_live` in productie                                                                             |
| `STRIPE_WEBHOOK_SECRET`                     | Nee*    | Webhook signing secret; optional `STRIPE_WEBHOOK_SECRET_PREVIOUS` during rotation                               |
| `STRIPE_PRICE_*_MONTHLY`                    | Nee*    | Allowlisted Price IDs per plan key                                                                              |
| `BILLING_TRIAL_DAYS` / `BILLING_GRACE_DAYS` | Nee     | Default 14 / 3                                                                                                  |
| `BILLING_DISPLAY_PRICE_*`                   | Nee     | Optional UI copy; not authorization                                                                             |
| `BILLING_TERMS_URL` / `_PRIVACY_URL`        | Nee     | Footer links on the billing page                                                                                |
| `GOOGLE_ADS_SYNC_INTERVAL_SECONDS`          | Nee     | Default 900                                                                                                     |
| `GOOGLE_ADS_OBSERVED_URL_LOOKBACK_DAYS`     | Nee     | Default 30, max 90                                                                                              |

Wijzig `.env.example` wanneer een nieuwe verplichte variabele wordt toegevoegd, zonder echte waarden op te nemen.
