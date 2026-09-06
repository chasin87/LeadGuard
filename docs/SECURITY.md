# Security-baseline

## In fase 4 aanwezig

- Serverconfiguratie wordt met Zod gevalideerd. Secrets staan uitsluitend in genegeerde `.env`-bestanden of de runtime environment.
- `.env.example` bevat alleen placeholders. `AUTH_SECRET` genereer je lokaal met `openssl rand -base64 32`.
- Wachtwoorden worden met Argon2id gehasht. Plaintext wachtwoorden worden niet opgeslagen of gelogd. `passwordHash` gaat niet mee in publieke DTO's of API-responses.
- Auth.js JWT-sessies gebruiken HttpOnly cookies, `SameSite=Lax`, en `Secure` in productie. Geen sessie in `localStorage`.
- Server Actions hebben Origin/CSRF-bescherming van Next.js. Auth.js beschermt zijn eigen auth-endpoints.
- Login toont een generieke foutmelding (`E-mailadres of wachtwoord is onjuist.`) om user enumeration te beperken. Onbekende accounts doen een dummy-hash-verify tegen timingverschil.
- Autorisatie zit in `src/server/authorization`. Elke tenant-read/write controleert user + organization + membership. De URL-slug is geen bewijs.
- Cross-tenant toegang (andere slug of ID) wordt geweigerd. Website-, monitor-, incident- en notificationrecords worden altijd geladen met tenant + parent ids. Een vreemd incident-id levert 404 zonder data van de andere tenant. Gebruikers kunnen incidents niet handmatig openen of resolven. Notification test/retry is geen willekeurige send-relay.
- OWNER-bescherming: de laatste OWNER kan niet worden verwijderd of gedegradeerd.
- Mass assignment wordt voorkomen met Zod-schema's; clients sturen geen rol of organizationId als vertrouwde input.
- Logging redigeert raw click IDs en revenuebedragen. Analytics-dashboard, GAQL en sync-logs bevatten geen raw GCLID/GBRAID/WBRAID. GAQL-datums/IDs worden intern gevalideerd; de UI stuurt geen eigen queries.
- Google Ads analytics jobs (`google_ads.analytics.sync`, click resolution) zijn read-only en lagere concurrency dan conversion-feedback writes. Backfill/manual refresh hebben cooldown + singleton per customer.
- De health endpoint geeft geen exceptiondetails, credentials of infrastructuurgegevens terug.
- Next.js' `poweredByHeader` is uitgeschakeld.
- TypeScript strict mode en `noUncheckedIndexedAccess` zijn actief.

## User-controlled URLs en SSRF

LeadGuard accepteert URLs van gebruikers. Later zal infrastructuur die URLs benaderen. SSRF is daarom een primaire threat.

Validatiepijplijn bij create/update:

```text
User input
↓
Zod (lengte / verplicht veld)
↓
URL parser (WHATWG)
↓
protocol validation (alleen http/https)
↓
hostname validation (geen credentials; websites: geen pad/query; monitors: pad toegestaan onder dezelfde host)
↓
poort allowlist (80 of 443)
↓
DNS resolution (A + AAAA, injecteerbaar in tests)
↓
IP classification (ipaddr.js)
↓
allow / deny
```

Een hostname die naar minimaal één verboden adres resolve, wordt geweigerd. Syntactisch onveilige of interne doelen worden altijd geblokkeerd. Een domein zonder DNS-records mag worden opgeslagen als `UNRESOLVED`; dat is geen uptime-status.

Een opgeslagen Monitor-URL is nooit automatisch trusted. Iedere check:

```text
stored URL
↓
parse
↓
validate protocol
↓
resolve DNS
↓
validate all IPs
↓
connect to the validated IP (Host + TLS SNI remain the original hostname)
↓
redirect?
↓
repeat validation
```

`assertPublicHttpTarget` draait vóór iedere hop. De HTTP-client gebruikt een pinned `lookup` zodat een tweede DNS-antwoord (rebinding) niet voor de TCP-connectie wordt gebruikt. Redirects naar privé/metadata-adressen worden als `UNSAFE_REDIRECT` opgeslagen zonder de volgende request uit te voeren.

### Wat wordt geblokkeerd

- Schema's anders dan `http`/`https` (`file`, `ftp`, `javascript`, `data`, `gopher`, `ssh`, …)
- Credentials in de URL (`user:pass@`)
- Paden, querystrings en fragments op Website-niveau (origins only)
- Poorten anders dan 80/443
- `localhost`, `*.local`, `*.internal` en vergelijkbare interne hostnamepatronen
- Loopback, RFC1918, link-local, CGNAT (`100.64.0.0/10`), unspecified, multicast, reserved
- IPv6 loopback, unique-local (`fc00::/7`), link-local (`fe80::/10`)
- Cloud metadata, waaronder `169.254.169.254` en `fd00:ec2::254`
- Alternatieve IPv4-representaties die de URL-parser canonicaliseert (`127.1`, dword, hex)

IP-classificatie gebruikt `ipaddr.js`, geen naïeve stringchecks. Onclassificeerbare resolved adressen worden geweigerd (fail closed).

## Organization RBAC vs Platform RBAC

`OrganizationMember.role` (OWNER / ADMIN / MEMBER) authorizes tenant data only. `OrganizationMember.role = ADMIN` is **not** a LeadGuard operator.

Platform operators use `PlatformAccess` (`SUPER_ADMIN` / `SUPPORT`) and `/platform-admin`. Signup cannot grant it. Direct URLs without platform access return 403. Platform queries do not impersonate customers. Secrets, OAuth refresh tokens, raw click IDs, password hashes and queue payloads are excluded from the console. See [Platform admin](PLATFORM_ADMIN.md).

Recommended production extra control for `/platform-admin`: Cloudflare Access, VPN, or IP allowlist. App-level checks remain mandatory.

## Rate limiting

Login, registratie, password reset, website create/update, Checkout/Portal/billing refresh, **Run check now**, notification create, **Send test** (1/30s per channel), delivery-retry en tracking-ingestion hebben een in-memory limiter. Dat is geen productieklare bescherming achter meerdere instances; tracking documenteert dezelfde beperking.

## Tracking ingestion

Publieke events (`POST /api/tracking/v1/events`) gebruiken de site key als identifier plus Origin-check tegen de Website-origin (`www`/apex sibling toegestaan, geen `*.example.com`). CORS is geen authenticatie. Server leads gebruiken `Authorization: Bearer lgsrv_…` (hash-only in de database). Attribution tokens zijn opaque, Website-scoped en niet single-use; Lead-idempotency loopt via `eventId`. Click IDs worden encrypted-at-rest met een HKDF-derived key (`click-id-aes-v1` / `click-id-hmac-v1`, salt `leadguard-tracking`) uit `CREDENTIAL_ENCRYPTION_KEY` — niet dezelfde AES-context als OAuth-tokens. Body max 64 KiB. Disabled Website of disabled tracking weigert nieuwe events.

Threats en controls: site-key copying (origin + rate limit), event spam, cross-tenant tokens, click-ID injectie (bounded opaque strings), duplicate Leads, oversized payloads, synthetic monitor pollution (`window.__LEADGUARD_MONITORING__`). Zie [Revenue attribution](REVENUE_ATTRIBUTION_FOUNDATION.md).

## Lead outcomes

Manual status/revenue updates zijn tenant-scoped (`leadId` + `organizationId`). Actor komt uit de sessie, niet uit de payload. `expectedVersion` blokkeert stale writes (`409`). `mutationId` maakt retries idempotent. Revenue-input is untrusted canonical decimal + ISO 4217; geen floats, geen negatieve bedragen, geen locale-strings in de DTO. Current revenue bestaat alleen bij WON. Logs bevatten `hasRevenue`/`currency`, geen exact bedrag. Raw click IDs blijven uit de outcome-UI. Zie [Lead & revenue data layer](LEAD_REVENUE_DATA_LAYER.md).

## Redirects

Na login bepaalt de server het doelpad. Client-supplied `callbackUrl`-waarden worden niet vertrouwd voor de post-login redirect.

HTTP-redirects van gemonitorde sites worden handmatig gevolgd. Elk doel gaat opnieuw door SSRF. `fetch({ redirect: "follow" })` wordt niet gebruikt.

## Webhook outbound requests

Webhook-URL's zijn user-controlled. Create/update gebruikt `resolveSafeOutboundTarget` (poort 80/443, geen credentials, geen privé-hosts). Elke delivery herhaalt `assertPublicHttpTarget` en verbindt via hetzelfde pinned-IP transport als monitoring. Redirects worden **niet** gevolgd.

Geblokkeerd: localhost, RFC1918, link-local, metadata (`169.254.169.254`), private IPv6, interne DNS-suffixes. Een hostname die naar een privé-IP resolve (DNS rebinding) wordt geweigerd vóór connect.

Signing: HMAC-SHA256 over `timestamp.rawBody`. Secrets staan in PostgreSQL zonder app-level encrypt-at-rest; ze komen niet in list-API's, client bundles, logs of exceptiontext. SMTP-wachtwoorden idem. E-mailadressen worden in logs gemaskeerd. Volledige webhook-URL's (query tokens) worden niet gelogd.

E-mailheaders gaan via Nodemailer; user input wordt gestript van CR/LF. HTML-templates escapen namen.

Er is geen publiek endpoint voor willekeurige e-mail of webhooks.

## HTML-parsing van gemonitorde pagina's

Response-HTML is volledig attacker-controlled. Soft-404 gebruikt `htmlparser2` in HTML-mode (geen XML-entity expansion / XXE):

- geen JavaScript-uitvoering
- geen images, stylesheets of andere externe resources laden
- geen `eval`
- input begrensd tot 128 KiB; decompressie tot dezelfde cap
- parserfouten zijn fail-open: de HTTP-check blijft het transport/status-resultaat, geen automatische site-down
- volledige body wordt niet opgeslagen, niet gelogd en niet in error tracking gestopt
- UI toont alleen voorgedefinieerde signal-codes, geen ruwe HTML (geen HTML-injection vanuit de target)

## Browser Worker (hoge risico)

De Browser Worker opent user-controlled URLs in Chromium. Dat is arbitrary HTML/JS:

```text
Public URL → Chromium → arbitrary HTML/JS
```

Mitigaties: pre-navigation SSRF, request intercept voor subresources (localhost, RFC1918, metadata, gevaarlijke schemes), tracking-blocklist, geen permissions, geïsoleerde BrowserContext, private screenshots, resource limits, apart workerproces. Chromium-DNS is **niet** identiek aan HTTP IP-pinning; productie **moet** network-level isolatie gebruiken (geen toegang tot metadata/RFC1918/localhost/internal). Zie [Browser monitoring](BROWSER_MONITORING.md).

Screenshots kunnen persoonsgegevens bevatten: alleen failures, private bucket, signed/authorized access, 30 dagen retention, geen publieke URL, geen e-mailbijlage.

## Form Monitoring (side effects)

FORM-checks versturen echte testleads via Chromium. Extra threats: arbitrary spam, SSRF via form action/fetch, PII in bodies, duplicate submissions, payment/destructive forms.

Controls: tenant ownership, website boundary, consent + verification before schedule, frequency ≥ 1 uur, één submit per check, geen automatische retry na mogelijke submit, geen body logging, dezelfde browser network policy, OWNER/ADMIN only, isolated context. Zie [Form monitoring](FORM_MONITORING.md).

## Lead receipt verification

`POST /api/receipts/webhook` en `POST /api/inbound/email/<provider>` zijn publiek bereikbaar maar vereisen een tenant- of provider-secret (Bearer of HMAC). Ongeldige signatures: 401. Onbekende `submissionId`: hetzelfde `202 accepted` als geldige callbacks (geen enumeratie). Replay is idempotent via hashed webhook-secret + unique `providerMessageId`. Body-limiet 256 KiB. Attachments worden niet gelezen of opgeslagen. Secret van organisatie A bevestigt nooit submission B. `submissionId` heeft 12 tekens entropy na een leesbare prefix. Zie [Lead receipt verification](LEAD_RECEIPT_VERIFICATION.md).

## Google Ads integrations

OAuth state is CSRF/replay-protected (hashed, expiry, single-use, org+user binding). Callback re-checks `integrations:manage`. Refresh tokens are AES-256-GCM encrypted; never hashed-only, never sent to the client or queue. Developer token is a platform secret and is never sent to Data Manager. Google destination URLs are untrusted: same parser, SSRF, website boundary, and new-host approval as hand-added monitors. Fake Ads and fake Data Manager providers are forbidden in production. LeadGuard has no Ads campaign/ad/budget/bid mutate code. The only Google write is Data Manager conversion `events.ingest` after explicit OWNER/ADMIN activation. Conversion jobs carry `exportId` / `leadId`, never click IDs or tokens. Granted OAuth scopes are stored; Data Manager is not assumed from an Ads-only token. Zie [Google Ads](GOOGLE_ADS.md), [conversion feedback](GOOGLE_ADS_CONVERSION_FEEDBACK.md) en [incident impact](GOOGLE_ADS_INCIDENT_IMPACT.md).

## External outcome ingestion

`POST /api/outcomes/v1/*` gebruikt dedicated `lgoi_` credentials (hash-only) of HMAC (`lgos_`, encrypted at rest, hash voor integriteit). Tracking site keys en `lgsrv_` secrets worden geweigerd. HMAC-timestamp ±5 minuten; `sourceEventId` is persistent idempotent. Organization ID komt uit de credential, nooit uit de body. Matching is exact (`externalLeadId` / `publicLeadId` / `ExternalLeadLink`) binnen allowed websites; geen fuzzy PII. Unmapped importkolommen worden niet opgeslagen. CSV/XLSX: 10 MB, 50k rijen, geen macros/formule-evaluatie, private artifact storage, 30 dagen raw retention. MEMBER kan niet linken, importeren of credentials roteren. CRM-mismatch is geen Incident. Zie [Outcome ingestion API](OUTCOME_INGESTION_API.md) en [Outcome imports](OUTCOME_IMPORTS.md).

## Billing

Stripe is de payment provider. LeadGuard slaat geen card number, CVC of expiry op. Checkout/Portal zijn Stripe-hosted. `POST /api/billing/stripe/webhook` verifieert `Stripe-Signature` vóór verwerking; de raw body is bounded. Stripe IDs uit de client zijn geen authorization: alleen `planKey` is toegestaan en wordt server-side gemapt. Portal sessions zijn Organization-scoped. Fake billing routes 404 tenzij `BILLING_PROVIDER=fake`, en fake is verboden in productie. Zie [Billing](BILLING.md).

## Grenzen van deze fase

Geen native CRM-connectors, geen authenticated monitoring, geen geo/proxy, geen AI op screenshots. TLS wordt gevalideerd. WhatsApp/SMS/Slack zijn nog geen first-class channels (generieke webhooks kunnen die platforms indirect voeden). Outcome ingestion is generic (API/HMAC/file); HubSpot/Pipedrive/Salesforce zitten er niet in. Google conversion feedback gebruikt Data Manager zonder userData/PII. Billing is Stripe Checkout/Portal; geen eigen tax engine of yearly invoicing.

Uitnodigen van leden, OAuth-login en verplichte e-mailverificatie zijn nog niet gebouwd. Password reset wel.

## Secretbeheer

Commit nooit `.env` of productiecredentials. Injecteer secrets op de server via een afgeschermde environment/configuratie. Log geen requestheaders, cookies, tokens, database-URL's of volledige foutobjecten zonder expliciete sanitization.

## Meldingen

Meld kwetsbaarheden privé aan het projectteam. Voeg geen exploits of credentials aan publieke issues toe.
