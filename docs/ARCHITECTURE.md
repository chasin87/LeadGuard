# Architectuur

## Fase 12

Een `AD_DESTINATION`-incident krijgt een `GoogleAdsIncidentImpact`-record. De Google Ads-worker haalt read-only clicks/`cost_micros` op, rekent een incidentvenster in de customer-timezone, en toont estimated vs reported spend zonder revenue-claims. Zie [Google Ads incident impact](GOOGLE_ADS_INCIDENT_IMPACT.md).

## Fase 11

Een Organization koppelt Google Ads via OAuth. Een read-only sync-worker ontdekt Final URLs (standard ads, Performance Max, expanded landing pages), dedupliceert ze tot `AD_DESTINATION`-monitors en hergebruikt de HTTP/soft-404/Incident/notification-stack. Zie [Google Ads](GOOGLE_ADS.md).

## Fase 10

Na een bevestigde form-submit kan LeadGuard optioneel wachten op downstream-ontvangst (`INBOUND_EMAIL` of `RECEIPT_WEBHOOK`). `MonitorCheck` blijft immutable form-resultaat. `LeadReceiptVerification` is de child-state. Timeout maakt een aparte `LEAD_RECEIPT_TIMEOUT`-check voor de Incident Engine. Zie [Lead receipt verification](LEAD_RECEIPT_VERIFICATION.md).

## Fase 9

Form monitoring hergebruikt de Browser Worker en Playwright. FORM-jobs staan op `monitor.form.check` met lagere concurrency en per-host locking. Echte testleads gaan alleen via de queue. Consent, verificatie en geen automatische retry na submit zijn verplicht. Zie [Form monitoring](FORM_MONITORING.md).

## Fase 8

Browser monitoring gebruikt dezelfde scheduler, Incident Engine en notification-laag. Playwright Chromium draait in een **apart workerproces** met eigen queue `monitor.browser.check` en lagere concurrency. Elke check krijgt een nieuwe `BrowserContext`. Failure-screenshots gaan naar `ArtifactStorage` (lokaal of S3-compatible), niet naar PostgreSQL. Zie [Browser monitoring](BROWSER_MONITORING.md).

## Fase 7

Soft-404-detectie hangt aan de bestaande HTTP-monitoringpipeline. Na een technisch succesvolle HTML-response leest de worker maximaal 128 KiB, runt een heuristische classifier (`src/server/monitoring/soft404`) en kan de check als `FAILURE` / `SOFT_404` markeren. De Incident Engine en notification-laag blijven ongewijzigd: het is gewoon een extra error type.

## Fase 6

LeadGuard gebruikt Next.js App Router voor de webapplicatie, PostgreSQL als datastore, Prisma als databaseclient, en pg-boss als PostgreSQL job queue. HTTP-monitoring draait in aparte scheduler- en workerprocessen. De Incident Engine evalueert elke opgeslagen `MonitorCheck` in dezelfde transactie en schrijft bij OPEN/RESOLVED een transactional outbox-event. Notificaties worden asynchroon door een aparte worker verwerkt.

De build gebruikt `output: standalone`, zodat deployment op een gewone Linux-server achter bijvoorbeeld Cloudflare geen Vercel-runtime vereist.

## Authenticatie

Auth.js gebruikt JWT-sessies (geschikt voor de Credentials-provider) met HttpOnly cookies. Registratie en login leven in server actions; wachtwoorden worden met Argon2id gehasht in `src/server/auth`. OAuth (Google/Microsoft) en magic links zijn nog niet ingeschakeld, maar `Account` en `VerificationToken` staan klaar in het schema.

`src/proxy.ts` doet alleen een optimistische sessiecheck (ingelogd of niet) voor `/app` en `/onboarding`. Dat is geen autorisatie. Elke pagina, server action en service controleert de echte sessie dicht bij de data.

## Multi-tenancy

```text
User
 │
 └── OrganizationMember
          │
          └── Organization
                    │
                    └── Website
                              │
                              └── Monitor (HTTP | BROWSER | FORM | AD_DESTINATION)
                                        │
                                        ├── MonitorCheck
                                        │     ├── BrowserCheckDetail?
                                        │     └── FormCheckDetail?
                                        ├── BrowserMonitorConfig?
                                        ├── FormMonitorConfig?
                                        ├── AdDestinationConfig?
                                        ├── LeadReceiptVerification?
                                        └── Incident
                    GoogleAdsConnection
                    GoogleAdsCustomer
                    GoogleAdsDestinationTarget
                    FormTestProfile
                    InboundEmailMessage
                              NotificationChannel
                              NotificationOutboxEvent
                              NotificationDelivery
```

User ↔ Organization is many-to-many via OrganizationMember. Website hoort bij exact één Organization. Monitor hoort bij exact één Website. MonitorCheck hoort bij exact één Monitor.

Actieve organisatie komt uit de route:

```text
/app/[organizationSlug]/dashboard
/app/[organizationSlug]/websites
/app/[organizationSlug]/websites/new
/app/[organizationSlug]/websites/[websiteId]
/app/[organizationSlug]/websites/[websiteId]/settings
/app/[organizationSlug]/websites/[websiteId]/monitors/new
/app/[organizationSlug]/websites/[websiteId]/monitors/[monitorId]
/app/[organizationSlug]/websites/[websiteId]/monitors/[monitorId]/settings
/app/[organizationSlug]/incidents
/app/[organizationSlug]/incidents/[incidentId]
/app/[organizationSlug]/checks/[checkId]/screenshot
/app/[organizationSlug]/settings
/app/[organizationSlug]/settings/members
/app/[organizationSlug]/settings/notifications
/app/[organizationSlug]/settings/notifications/new
/app/[organizationSlug]/settings/notifications/[channelId]
/app/[organizationSlug]/integrations/google-ads
/app/[organizationSlug]/integrations/google-ads/destinations/[targetId]
```

De slug in de URL is nooit voldoende autorisatie. De centrale laag in `src/server/authorization` eist:

```text
authenticated user + organization + membership
```

Helpers:

- `requireUser()` — sessie of redirect naar `/login`
- `requireOrganizationMembership()` — lidmaatschap of 403
- `requireOrganizationRole()` — permissiecheck
- `requireOrganizationOwner()` — OWNER-rechten

## Rollen

| Rol    | Mag                                                                          |
| ------ | ---------------------------------------------------------------------------- |
| OWNER  | Organisatie, websites en monitors beheren                                    |
| ADMIN  | Websites en monitors beheren; leden bekijken                                 |
| MEMBER | Organisatie, websites, monitors, incidents en notification settings bekijken |

Website-permissies:

- `websites:read` — OWNER, ADMIN, MEMBER
- `websites:manage` — OWNER, ADMIN
- `monitors:read` — OWNER, ADMIN, MEMBER
- `monitors:manage` — OWNER, ADMIN (CRUD, pauzeren, Run check now, receipt config, secret rotatie)
- `incidents:read` — OWNER, ADMIN, MEMBER (geen user-mutations)
- `notifications:read` — OWNER, ADMIN, MEMBER
- `notifications:manage` — OWNER, ADMIN (channels, test, retry)

Permissies staan in `src/server/authorization/permissions.ts`. UI-verbergen is geen security boundary. Websitequeries filteren altijd op `id` én `organizationId`.

## Organisatierouting

Na login:

1. geen organisaties → `/onboarding`
2. laatst gebruikte organisatie (als membership nog geldt) → die dashboard
3. precies één organisatie → die dashboard
4. meerdere organisaties → `/app` selector

Een extra organisatie aanmaken gaat via de switcher naar `/app/organizations/new`. Aanmaak van Organization + OWNER-membership gebeurt in één database-transactie.

## Database

Nieuwe tenant-modellen moeten `organizationId` (of een nested relation naar Organization) krijgen. Voeg nooit klantdata toe die alleen aan User hangt als die data bij een organisatie hoort.

### Website

Een Website is een publieke origin (`scheme://hostname`), geen pad of query. Status is configuratie (`ACTIVE` / `DISABLED`), geen health.

Uniqueness: `(organizationId, normalizedUrl)`. Indexes: `organizationId`, `hostname`. IDs zijn `cuid()`.

Als een Organization wordt verwijderd, cascade-verwijderen Websites, Monitors en MonitorChecks mee. Website-delete is hard delete. Monitor-delete is soft-delete (`deletedAt`); checkhistorie blijft bewaard.

### Monitor

HTTP-checkdoel onder een website-origin. Status `ACTIVE`/`PAUSED` is scheduling. Health komt uit recente `MonitorCheck`. Indexes: `websiteId`, `(status, nextCheckAt)`, due partial index, unique `(websiteId, normalizedUrl)` waar `deletedAt IS NULL`.

Zie [Monitoring](MONITORING.md) voor scheduler, queue, worker en HTTP-lifecycle.

### URL-normalisatie

Alle website-input gaat door `src/lib/urls/normalize-url.ts`:

- whitespace trimmen
- ontbrekend protocol → `https`
- expliciet `http` blijft `http`
- hostname lowercase
- geen trailing slash in de opgeslagen origin
- `www` en non-www blijven verschillende websites
- alleen poort 80 (http) of 443 (https)

Securityvalidatie (SSRF, DNS, IP-ranges) zit in `src/server/security/ssrf.ts`. Zod valideert alleen syntactische invoerlengte; het is geen security boundary.

Businesslogica leeft in `src/server/websites/service.ts`. Server actions vertrouwen geen client-supplied `organizationId`.

## Procesgrenzen

De beoogde runtime bestaat uit vier afzonderlijk te starten rollen:

1. **Web application** — dashboard, authenticatie, instellingen en API.
2. **Monitoring worker** — voert checks uit buiten webrequests.
3. **Scheduler** — plant verschuldigde checks in de PostgreSQL-backed queue.
4. **Notification worker** — verwerkt meldingen onafhankelijk en idempotent.

De directories `src/workers` en `src/jobs` bevatten de scheduler, pg-boss queue en monitoring worker. De worker roept `assertPublicHttpTarget()` vóór iedere outbound request aan, en opnieuw voor iedere redirect.

## Modulair ontwerp

Featurecode komt in `src/features/<feature>`. UI blijft dun; validatie, services en domeinregels leven binnen de feature of serverlaag. Integraties krijgen adapters onder `src/integrations`. Gedeelde infrastructuur hoort in `src/server`, terwijl universele utilities in `src/lib` staan.

Auth-, tenant- en websitelogica:

- `src/server/auth`
- `src/server/authorization`
- `src/server/organizations`
- `src/server/websites`
- `src/server/monitors`
- `src/server/monitoring`
- `src/server/incidents`
- `src/server/notifications`
- `src/server/receipts`
- `src/server/monitoring/soft404`
- `src/jobs`
- `src/workers`
- `src/server/security`
- `src/lib/urls`

## Deployment

Productieprocessen: `leadguard-web`, `leadguard-scheduler`, `leadguard-worker`, `leadguard-notification-worker` (PM2 of systemd). PostgreSQL is gedeeld, inclusief pg-boss. De in-memory rate limiter blijft per proces; vervang die vóór productie achter een load balancer. Per-host concurrency is globaal via pg-boss (`groupConcurrency`, max 2). Notification-concurrency staat los van monitoring-concurrency.
