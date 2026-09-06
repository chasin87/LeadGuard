# Browser monitoring

LeadGuard kan naast HTTP-beschikbaarheid controleren of een pagina in een echte browser bruikbaar rendert.

```text
HTTP Monitor:  is deze URL technisch bereikbaar?
Browser Monitor: kan een bezoeker de pagina zien en gebruiken?
```

Dit zijn aparte monitor types. Een HTTP-check opent geen Chromium. Browserchecks zijn zwaarder en moeten expliciet worden aangemaakt.

```text
Scheduler
   ↓
pg-boss
   ├── monitor.check          → HTTP Worker
   └── monitor.browser.check  → Browser Worker → Playwright Chromium
```

## Architectuur

De bestaande scheduler plant due monitors. Het type bepaalt de queue. HTTP-jobs blijven op `monitor.check` met `MONITOR_WORKER_CONCURRENCY` (default 5). Browser-jobs gaan naar `monitor.browser.check` met `BROWSER_WORKER_CONCURRENCY` (default 2). Groepen zijn gescheiden (`hostname` vs `browser:hostname`), zodat een trage Chromium-check HTTP-monitoring niet blokkeert. FORM-monitors met een PENDING receipt worden overgeslagen; due receipt-timeouts draaien in dezelfde scheduler-tick.

De Browser Worker is een apart Node-proces (`npm run worker:browser`). Playwright start **nooit** in een Next.js request. **Run check now** enqueue’t alleen.

Per check:

```text
persistent Chromium
  → nieuwe BrowserContext
  → nieuwe Page
  → check
  → Page + Context sluiten (try/finally)
```

Geen cookies, localStorage, sessionStorage of authentication state tussen checks. Service workers staan op `block`. Na `BROWSER_RECYCLE_AFTER_CHECKS` (default 50) wordt het browserproces herstart.

## Configuratie

| Veld                          | Opmerking                                                                                    |
| ----------------------------- | -------------------------------------------------------------------------------------------- |
| Name, URL, frequency, timeout | Zelfde website-boundary als HTTP                                                             |
| Viewport                      | Alleen presets: Desktop 1440×900, Mobile 390×844                                             |
| Required element              | Optionele CSS selector + zichtbare naam. Attributen in haakjes, bijv. `[data-slot="button"]` |
| Frequency                     | Minimaal 10 minuten, default 10 minuten                                                      |
| Timeout                       | Default 20s, max 45s                                                                         |

Geen willekeurige pixelmaten, geen form fill, geen clicks, geen login.

## Rendering checks

Na `page.goto({ waitUntil: "domcontentloaded" })` volgt een korte stabilisatietijd (geen `networkidle`). Daarna:

- HTTP-status van het hoofddocument
- required element: attached **en** visible
- zichtbare tekst + DOM-signalen voor lege pagina’s
- dezelfde soft-404 classifier op gerenderde zichtbare tekst
- begrensde `pageerror` / console.error-metadata (diagnostisch)
- begrensde failed resources (document/script/stylesheet/xhr/fetch)

Één JavaScript console error maakt de site niet down. Harde failure alleen bij navigatie/crash, ontbrekend required element, gerenderde soft-404, duidelijke blank page, of ernstige JS samen met een gebroken pagina.

## Classificatie (hoogste eerst)

```text
unsafe main document
> navigation timeout / navigation error
> browser/page crash
> invalid selector (geen incident)
> HTTP 4xx/5xx op het hoofddocument
> rendered soft-404
> required element missing
> blank page
> severe JS + broken page
> slow but usable (DEGRADED)
> success
```

Als de hele pagina een gerenderde foutpagina is, wint `SOFT_404` van een ontbrekend required element.

`INVALID_MONITOR_CONFIGURATION` is een gebruikersfout. De Incident Engine opent hiervoor geen incident en telt geen consecutive failures.

`DEGRADED` (trage maar bruikbare render, default > 10s) opent geen outage.

## Screenshots

Alleen bij relevante FAILURE, viewport-only JPEG, geen full-page, geen succesvolle checks. Bytes gaan naar object storage (`ArtifactStorage`), niet naar PostgreSQL. `BrowserCheckDetail.screenshotKey` is alleen een sleutel.

Toegang: `/app/[organizationSlug]/checks/[checkId]/screenshot` na authenticatie + organization membership + check hoort bij die org. Geen publieke permanente URL. Retention default 30 dagen (`ARTIFACT_RETENTION_DAYS`); de scheduler ruimt verlopen keys op.

Screenshot-upload mag de check nooit blokkeren. Storage failure wordt gelogd; de MonitorCheck en Incident Engine blijven werken. E-mail krijgt geen screenshot-bijlage.

## Security

De Browser Worker voert attacker-controlled HTML/JS uit. Dat is een grotere aanvalsvector dan HTTP-monitoring.

Defence in depth:

1. Hoofddocument: bestaande `assertPublicHttpTarget` vóór `goto`
2. Alle outbound requests via Playwright routing: protocol, hostname, IP
3. Blokkeer localhost, RFC1918, link-local, metadata, private IPv6, `file:`, `ftp:`, `chrome:`, `devtools:`
4. Bekende analytics/conversion-endpoints worden geblokkeerd (geen willekeurige CDN-assets)
5. Media (`video`/`audio`) wordt geblokkeerd; downloads gecanceld; popups gesloten; dialogs dismissed
6. Geen camera/microfoon/geolocation/notifications
7. Nieuwe BrowserContext per check
8. Private screenshot storage, tenant-gated URLs
9. **Productie: network isolation** — de worker mag internet op, maar niet naar metadata-IPs, RFC1918, localhost-services of interne adminnetwerken

### Eerlijke beperking: DNS rebinding

De HTTP-worker pint TCP op het gevalideerde IP. Chromium beheert zelf DNS. LeadGuard kan niet identiek pinnen per subresource. Compensatie: pre-navigation DNS, request intercept + IP-literal checks, hostname blocklist, en **verplichte container/firewall isolatie** in productie. App-level blocking alleen is geen schijnveiligheid-claim voor volledige rebinding-immuniteit.

### Tracking

LeadGuard klikt geen CTA’s in Browser Monitoring. Form Monitoring submit wel, maar blijft tracking-endpoints blokkeren. 100% voorkomen van client-side conversion is niet gegarandeerd.

## Infrastructuur vs sitefailure

Ontbrekende Chromium-binary, launch failure of een dood browserproces is een **job failure** met retry. Er wordt geen `MonitorCheck FAILURE` opgeslagen en geen klantincident geopend.

Als de pagina zelf de tab/browser laat crashen tijdens een check, is dat wel een monitor-FAILURE (`PAGE_CRASH` / `BROWSER_CRASH`).

De worker herstart Chromium na disconnect of recycle.

## Resource impact

Eén headless Chromium: grofweg honderden MB RAM (vaak 250–600 MB plus page). Default concurrency 2 is bewust laag. Queue-backlog blijft in pg-boss; de scheduler zet `nextCheckAt` op nu+interval (geen catch-up storm). Singleton per monitor voorkomt parallelle checks op dezelfde monitor.

## Wat Browser Monitoring niet doet

Formulieren invullen is **Form Monitoring**. Zie [Form monitoring](FORM_MONITORING.md).

Browser Monitoring zelf doet geen:

- form fill of testleads
- authenticated / cookie / basic-auth monitoring
- click journeys
- geo/proxy monitoring
- Firefox/WebKit
- Web Vitals / Lighthouse
- AI op screenshots
- billing / plantiers
- Google Ads writes; destination health is HTTP monitoring, zie [Google Ads](GOOGLE_ADS.md)
- revenue attribution; elke isolated context zet `window.__LEADGUARD_MONITORING__` zodat de Tracking SDK no-op’t
