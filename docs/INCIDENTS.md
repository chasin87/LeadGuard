# Incidents

Een `MonitorCheck` is één meting. Een `Incident` is een reeks opeenvolgende failures die één storing voorstellen.

```text
              SUCCESS
                 │
                 ▼
            OPERATIONAL
                 │
              FAILURE
                 ▼
             FAILING
                 │
       threshold reached
                 ▼
          INCIDENT OPEN
                 │
              FAILURE
                 │
                 └────→ remains OPEN
                 │
              SUCCESS
                 ▼
        INCIDENT RESOLVED
                 │
                 ▼
            OPERATIONAL
```

## Lifecycle

Default threshold: **2** consecutive `FAILURE`-checks (`consecutiveFailuresBeforeIncident`, 1–10).

- Eén failure → geen incident (FAILING).
- Tweede opeenvolgende failure → precies één OPEN incident.
- `startedAt` = starttijd van de **eerste** failure in de reeks.
- `detectedAt` = eindtijd van de check die de threshold haalde.
- Extra failures updaten `latestErrorType`, `lastFailedCheckId` en `failureCount`. Geen tweede OPEN incident.
- `SUCCESS` of `DEGRADED` lost een OPEN incident op. `resolvedAt` = eindtijd van die recovery-check.

`AD_DESTINATION`-incidenten krijgen een aparte impactberekening (clicks/`cost_micros`) die het incident zelf nooit blokkeert. Zie [Google Ads incident impact](GOOGLE_ADS_INCIDENT_IMPACT.md).

- Daarna een nieuwe failure-reeks opent Incident B.

Gebruikers kunnen incidents niet handmatig openen of resolven.

## DEGRADED

`DEGRADED` (trage 2xx) opent geen incident en zet `consecutiveFailures` op 0. Een OPEN incident wordt daarmee ook resolved: de pagina antwoordde succesvol.

HTTP 401/403/429 blijven Fase 4-failures en kunnen dus een incident openen, inclusief als de bot zelf geratelimited wordt. `SOFT_404` (HTTP 200 maar inhoudelijk een foutpagina, of client-side gerenderde 404 via Browser Monitor) is dezelfde `FAILURE` en telt mee voor threshold, openen en recovery. `INVALID_MONITOR_CONFIGURATION`, `UNSUPPORTED_CAPTCHA` en `UNSUPPORTED_FORM_TYPE` openen **geen** incident. Form runtime-failures (`FORM_SUBMISSION_FAILED`, `FORM_SUCCESS_NOT_CONFIRMED`, verdwenen velden) wel. `LEAD_RECEIPT_TIMEOUT` is een vertraagde downstream-failure: de form-`MonitorCheck` blijft SUCCESS; timeout schrijft een aparte FAILURE-check. Twee opeenvolgende receipt-timeouts openen een incident. Een late receipt lost dat incident niet op; de volgende `RECEIVED` test wel. Health `pending_confirmation` geldt zolang receipt `PENDING` is. Zie [Soft-404](SOFT404.md), [Browser monitoring](BROWSER_MONITORING.md), [Form monitoring](FORM_MONITORING.md) en [Lead receipt verification](LEAD_RECEIPT_VERIFICATION.md).

## Idempotency en concurrency

Check + monitorstate + incident zitten in **één database-transactie**, met `SELECT … FOR UPDATE` op de Monitor-rij. `MonitorCheck.incidentProcessedAt` voorkomt dubbele verwerking van hetzelfde check-id.

Per monitor bestaat maximaal één OPEN incident (partial unique index `Incident_monitorId_open_key`). pg-boss exclusive + advisory lock uit Fase 4 voorkomen parallelle jobs voor dezelfde monitor; de engine vertrouwt daar niet alleen op.

Out-of-order: een check met `finishedAt` ouder dan `lastCheckedAt` wijzigt de actuele incidentstate niet.

## Pauze / disable / archive

Pauzeren of website disable **resolvedt niet**. Er is geen bewijs dat het probleem weg is. UI: recovery kan pas als monitoring hervat.

Soft-delete van een monitor bewaart checks en incidents. Hard-delete van een website cascaden nog steeds monitors, checks en incidents (bestaande Fase 3/4-keuze).

## Historische Fase 4-data

Bestaande `consecutiveFailures` zijn bij migratie op 0 gezet. Oude checks worden niet terugvertaald naar incidents.

Threshold-wijzigingen gelden vanaf de **volgende** check, niet meteen.

## Health

Afgeleid, niet opgeslagen:

- Monitor: Pending / Waiting for receipt / Operational / Degraded / Failing / **Down** (open incident)
- Website: de ernstigste monitorhealth

## Notificaties

Zie [Notifications](NOTIFICATIONS.md). Incident OPEN/RESOLVED schrijft een outbox-rij in dezelfde transactie. De notification-worker fanned-out naar EMAIL- en WEBHOOK-channels. Monitoring wacht nooit op SMTP of webhooks. `AD_DESTINATION`-incidents voegen Google Ads sourcecontext toe (aantal enabled references, campagnenamen), zonder spend-at-risk. Meerdere ads naar dezelfde URL blijven één incident.
