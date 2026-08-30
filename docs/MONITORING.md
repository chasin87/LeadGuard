# HTTP monitoring

LeadGuard controleert publieke HTTP/HTTPS-pagina's periodiek, onafhankelijk van de Next.js-webserver.

```text
          ┌───────────────┐
          │ Next.js App   │
          └───────┬───────┘
                  │ CRUD
                  ↓
          ┌───────────────┐
          │ PostgreSQL    │
          └───────┬───────┘
                  │ due monitors
                  ↓
          ┌───────────────┐
          │ Scheduler     │
          └───────┬───────┘
                  │ enqueue
                  ↓
          ┌───────────────┐
          │ pg-boss queue │
          └───────┬───────┘
                  ↓
          ┌───────────────┐
          │ Worker        │
          └───────┬───────┘
                  │
          SSRF + DNS + pinned IP
                  ↓
          Public website
                  ↓
          MonitorCheck
```

## Modellen

`Website` → `Monitor` → `MonitorCheck`.

- `Monitor.status` is `ACTIVE` of `PAUSED` (scheduling, geen health).
- Health komt uit de laatste `MonitorCheck`: Success → Operational, Failure → Failing, Degraded → Degraded, geen check → Pending first check. FORM-monitors met receipt `PENDING` zijn `pending_confirmation`.
- `Monitor.type` is `HTTP`, `BROWSER` of `FORM`.
- Soft-delete via `deletedAt`: de monitor verdwijnt uit de UI en scheduler, checkhistorie blijft staan.

Uniqueness: dezelfde website mag dezelfde genormaliseerde URL **per type** niet twee keer actief hebben. HTTP + Browser + Form op dezelfde URL is geldig. Na archiveren mag dezelfde combinatie opnieuw.

## Website-boundary

Een monitor-URL moet dezelfde **scheme + hostname + poort** hebben als de Website. `www.example.com` is niet hetzelfde als `example.com`. Paden en querystrings zijn toegestaan; fragments en credentials niet. Relatieve paden zoals `/airco` worden tegen de website-origin opgelost.

## Scheduler

Het schedulerproces zoekt `ACTIVE` monitors onder een `ACTIVE` website met `nextCheckAt <= now()`, met `FOR UPDATE SKIP LOCKED`. FORM-monitors met een PENDING receipt of zonder `receiptVerifiedAt` (als receipt mode aan staat) worden overgeslagen. Due receipt-timeouts worden in dezelfde tick verwerkt. Daarna wordt `nextCheckAt` gezet op **nu + interval**, niet op de gemiste slot. Lange downtime geeft dus één inhaalcheck, geen job-flood. Twee schedulerprocessen kunnen dezelfde rij niet dubbel claimen.

## Queue

pg-boss in PostgreSQL:

- `monitor.check` — HTTP worker, policy `exclusive` + `singletonKey = monitorId`
- `monitor.browser.check` — Browser worker, dezelfde exclusive/singleton-regel, andere group-id zodat Chromium HTTP niet blokkeert
- `monitor.form.check` — dezelfde Chromium-worker, `form:{hostname}` group, default concurrency 1

Maximaal één queued of active job per monitor. `retryLimit` 2 geldt alleen voor technische jobfailures. Een HTTP 404 of missing required element is een geslaagde job met checkstatus `FAILURE`. Chromium die niet start is een technische jobfailure zonder MonitorCheck. FORM-jobs retryen na mogelijke submit **niet** met een tweede echte lead.

Zie [Browser monitoring](BROWSER_MONITORING.md), [Form monitoring](FORM_MONITORING.md) en [Lead receipt verification](LEAD_RECEIPT_VERIFICATION.md).

## Worker

Haalt de actuele Monitor + Website uit de database. Pauzes en disabled websites worden overgeslagen. Daarna:

1. PostgreSQL session advisory lock op een dedicated connection (niet via de Prisma-pool, zodat lock en unlock op dezelfde sessie blijven)
2. max 2 gelijktijdige checks per hostname, globaal via pg-boss `groupConcurrency` en extra in-process limiter
3. HTTP GET met SSRF + pinned IP
4. `MonitorCheck` opslaan; bij DB-fout faalt de job zodat retry mogelijk is

Concurrency: `MONITOR_WORKER_CONCURRENCY` (standaard 5). Als dezelfde monitor al gelockt is, faalt de job bewust zodat pg-boss kan retryen.

## HTTP-check

- Alleen GET. Geen cookies, geen auth-headers.
- User-Agent: `LeadGuardBot/1.0 (+https://leadguard.app)` (overschrijfbaar).
- Timeouts 1–30s, default 10s, begrenzen de hele check inclusief redirects.
- Response bodies worden niet opgeslagen. Voor soft-404 leest de worker maximaal 128 KiB en stopt daarna de stream. Gzip/br/deflate worden tot dezelfde cap gedecomprimeerd.
- Redirects (301/302/303/307/308) worden handmatig gevolgd, max 10. Elke `Location` wordt opnieuw genormaliseerd en met SSRF gevalideerd. Loops worden herkend. Relative locations worden t.o.v. de huidige URL opgelost.
- TLS: `rejectUnauthorized` blijft aan. Certificaatfouten → `SSL_ERROR`.

## Classificatie

| Situatie                              | Status   | Error                                              |
| ------------------------------------- | -------- | -------------------------------------------------- |
| 200–299, snel, geen soft-404          | SUCCESS  | —                                                  |
| 200–299, > 5000 ms, geen soft-404     | DEGRADED | —                                                  |
| 200–299 HTML die een foutpagina lijkt | FAILURE  | SOFT_404                                           |
| 404                                   | FAILURE  | HTTP_404                                           |
| 401 / 403 / 429                       | FAILURE  | HTTP_401 / HTTP_403 / HTTP_429                     |
| overige 4xx                           | FAILURE  | HTTP_4XX                                           |
| 5xx                                   | FAILURE  | HTTP_5XX                                           |
| timeout / DNS / TLS / connect         | FAILURE  | TIMEOUT / DNS_ERROR / SSL_ERROR / CONNECTION_ERROR |

Op een publieke marketingpagina zijn 401/403/429 problemen. Soft-404 weegt zwaarder dan latency-DEGRADED. Zie [Soft-404](SOFT404.md).

`consecutiveFailures`: +1 bij FAILURE, 0 bij SUCCESS en DEGRADED. DEGRADED opent geen incident. Zie [Incidents](INCIDENTS.md).

## DNS rebinding

Een opgeslagen URL is nooit trusted. Per hop:

1. parse + protocol/host/poort
2. DNS A/AAAA
3. alle IPs classificeren (`ipaddr.js`)
4. verbinden naar het **reeds gevalideerde IP**
5. `Host` en TLS SNI blijven de oorspronkelijke hostname
6. custom `lookup` geeft alleen dat IP terug, zodat de HTTP-client niet opnieuw mag resolven

## Lokale processen

```bash
npm run dev
npm run scheduler
npm run worker
npm run worker:browser
npm run worker:notifications
npm run worker:google-ads
```

Productie (documentatie, geen deployment): aparte processen `leadguard-web`, `leadguard-scheduler`, `leadguard-worker`, `leadguard-browser-worker`, `leadguard-notification-worker`, `leadguard-google-ads-worker` (PM2 of systemd). PostgreSQL is gedeelde infrastructuur. Geen Docker Compose in deze repository.

## Performance

Soft-404 voegt milliseconden CPU per succesvolle HTML-check toe: bounded parse, geen browser, geen externe API. 128 KiB max. Zie [Soft-404](SOFT404.md).

`MonitorCheck` groeit snel (~288 rijen/dag per monitor bij 5 minuten). Indexes: `(monitorId, createdAt)`, `createdAt`. Een cleanup/retention-job hoort bij een latere operations-fase.

Google Ads destinations gebruiken hetzelfde HTTP-checkpad als `HTTP`-monitors (`AD_DESTINATION` is een producttype). Zie [Google Ads](GOOGLE_ADS.md).
