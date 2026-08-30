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
- De logging abstraction redigeert bekende gevoelige contextvelden, waaronder password/secret/token/cookie/credential/developer. Websitevalidatie logt hostname/reason, geen credentials. Inbound e-mail en receipt-webhooks loggen geen message body, sender-adres of webhook-secret. Google Ads-logs bevatten geen refresh token, access token, developer token of encryption key.
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

## Rate limiting

Login, registratie, website create/update, **Run check now**, notification create, **Send test** (1/30s per channel) en delivery-retry hebben een in-memory limiter. Dat is geen productieklare bescherming achter meerdere instances.

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

OAuth state is CSRF/replay-protected (hashed, expiry, single-use, org+user binding). Callback re-checks `integrations:manage`. Refresh tokens are AES-256-GCM encrypted; never hashed-only, never sent to the client or queue. Developer token is a platform secret. Google destination URLs are untrusted: same parser, SSRF, website boundary, and new-host approval as hand-added monitors. Fake provider is forbidden in production. LeadGuard has no Ads mutate/pause/conversion-upload code. Incident impact jobs carry only `incidentId`. Zie [Google Ads](GOOGLE_ADS.md) en [incident impact](GOOGLE_ADS_INCIDENT_IMPACT.md).

## Grenzen van deze fase

Geen native CRM-connectors, geen authenticated monitoring, geen geo/proxy, geen AI op screenshots. TLS wordt gevalideerd. WhatsApp/SMS/Slack zijn nog geen first-class channels (generieke webhooks kunnen die platforms indirect voeden).

Uitnodigen van leden, OAuth en magic links zijn nog niet gebouwd.

## Secretbeheer

Commit nooit `.env` of productiecredentials. Injecteer secrets op de server via een afgeschermde environment/configuratie. Log geen requestheaders, cookies, tokens, database-URL's of volledige foutobjecten zonder expliciete sanitization.

## Meldingen

Meld kwetsbaarheden privé aan het projectteam. Voeg geen exploits of credentials aan publieke issues toe.
