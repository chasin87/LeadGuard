# Notifications

LeadGuard waarschuwt organisaties wanneer een Incident opent of resolved. Notificaties zijn een downstream-laag. Monitoring en de Incident Engine blijven de bron van waarheid.

```text
MonitorCheck
     ↓
Incident Engine
     ↓
DB Transaction
     ├── Incident transition
     └── Outbox event
              ↓
       Outbox dispatcher
              ↓
       NotificationDelivery
              ↓
          Job Queue
              ↓
    Notification Worker
         ┌────┴────┐
         ↓         ↓
       Email     Webhook
```

## Wanneer wordt er gewaarschuwd?

Alleen bij Incident-transitions:

- `INCIDENT_OPENED` — threshold bereikt, precies één event per incident
- `INCIDENT_RESOLVED` — recovery-check, precies één event per incident

Een losse failure onder de threshold maakt geen incident en dus geen alert. Extra failures op een OPEN incident updaten het incident maar sturen geen nieuwe opened-alert.

De engine doet **geen** `sendEmail()` of webhook I/O. In dezelfde database-transactie als de transition wordt een `NotificationOutboxEvent` gezet. Als de app daarna crasht, blijft het event staan.

## Payloadkeuze

Outbox-payload `version: 1` bevat IDs **en** een kleine immutable snapshot (`websiteName`, `monitorName`, `monitorUrl`, timestamps, errorType, errorMessage). De worker leest die snapshot zodat een latere naamwijziging of monitor-archive de al verstuurde alert begrijpelijk houdt. Actuele channelconfig komt uit de database. Browser-fouten zoals `REQUIRED_ELEMENT_MISSING` gebruiken dezelfde formatter (`Required element missing: Offerte aanvragen`). Screenshots gaan niet mee in e-mail.

## Channels

Organization-owned, max 10 (niet-verwijderd):

| Type    | Config              | Status          |
| ------- | ------------------- | --------------- |
| EMAIL   | naam + e-mailadres  | ACTIVE/DISABLED |
| WEBHOOK | naam + publieke URL | ACTIVE/DISABLED |

Voorkeuren per channel: incident opened / resolved. Disabled channels krijgen geen nieuwe deliveries. Pending deliveries van een channel dat disabled of soft-deleted wordt, gaan naar `SKIPPED`. Deliveryhistorie blijft bewaard (`deletedAt` op het channel).

Rollen: OWNER/ADMIN beheren; MEMBER mag bekijken.

## Email

`EmailProvider.send()` is de abstraction. Adapters:

- **SMTP** (Nodemailer) wanneer `SMTP_HOST` is gezet
- **Console** in development zonder SMTP (logt onderwerp + gemaskeerd adres, geen HTML-dump)
- **Unconfigured** in production zonder SMTP: deliveries falen zichtbaar, er wordt niet gedaan alsof mail is verstuurd
- **Memory/scripted** in tests

Businesslogica hangt niet aan Nodemailer. Templates staan in `src/server/notifications/templates/`. HTML én plain text. User-controlled namen worden ge-escaped. Onderwerpregels strippen CR/LF.

SMTP is **at-least-once** met sterke duplicate-reductie. Er is geen native SMTP-idempotency. Als de server het bericht accepteert maar het client-ack verloren gaat, kan een retry een tweede mail sturen. Dat is gedocumenteerd, geen exactly-once-claim.

## Webhooks

POST JSON, `Content-Type: application/json`, `User-Agent: LeadGuard-Webhook/1.0`, timeout 10s. **Geen redirects** — 3xx is een permanente configuratiefout. SSRF: dezelfde `assertPublicHttpTarget` + pinned-IP transport als monitoring (poort 80/443, geen privé-IP, DNS opnieuw valideren vlak voor connect). Querystrings worden niet gelogd.

Signing:

```text
X-LeadGuard-Event: incident.opened
X-LeadGuard-Delivery: <stable delivery id>
X-LeadGuard-Timestamp: <unix seconds>
X-LeadGuard-Signature: sha256=<hex>
```

HMAC-SHA256 over `timestamp + "." + raw body`. Ontvangers moeten signatures met een constant-time compare vergelijken. Secret is `lgwh_` + 32 random bytes, server-generated, roteerbaar. Geen encrypt-at-rest in deze fase: plaintext in PostgreSQL, nooit in list-DTO's, logs of test-snapshots. Reveal alleen voor OWNER/ADMIN.

Payload `version: 1`, o.a. `incident.opened`, `incident.resolved`, `notification.test`.

## Delivery-semantiek

| Stap       | Garantie                                                                          |
| ---------- | --------------------------------------------------------------------------------- |
| Outbox     | Transactioneel met incident; unique per event                                     |
| Dispatcher | `FOR UPDATE SKIP LOCKED`; unique idempotency key `incidentId:eventType:channelId` |
| Queue      | pg-boss `notification.delivery`, `retryLimit: 0`, `singletonKey=deliveryId`       |
| Worker     | Claim via `UPDATE … WHERE PENDING`; at-least-once                                 |

Status: `PENDING` → `SENDING` → `SENT` of retry `PENDING` of terminal `FAILED` / `SKIPPED`.

Retries: max 5 pogingen. Backoff 1 min, 5 min, 30 min, 2 uur + jitter (geen jitter in tests). Retry bij timeout, connectiefout, SMTP 421/450/451/452, webhook 429 en 5xx. Permanent o.a. SMTP 550, auth, webhook 400/401/403/404, SSRF.

## Processen

De notification-dispatcher zit in `npm run worker:notifications` (niet in de monitor-scheduler), zodat alerts niet stilvallen als alleen de HTTP-scheduler down is, en SMTP een trage mailserver de monitor-queue niet blokkeert.

```text
leadguard-web
leadguard-scheduler
leadguard-monitor-worker      → npm run worker
leadguard-notification-worker → npm run worker:notifications
```

Zonder notification-worker blijven incidents openen; events blijven in de outbox.

## Lokaal testen

Development zonder SMTP gebruikt de console-provider. Optioneel Mailpit:

```bash
# voorbeeld, niet in-repo
SMTP_HOST=localhost
SMTP_PORT=1025
EMAIL_FROM="LeadGuard <leadguard@localhost>"
```

```bash
npm run worker:notifications
```

Send test in Settings → Notifications is geen incident. Cooldown: 1 test per channel per 30 seconden.

## Retention

Deliveryhistorie wordt bewaard. Geen automatische deletion in deze fase. Organization-delete cascaden channels, outbox en deliveries.

## Bewuste grenzen

Geen WhatsApp, SMS, Slack, periodieke reminders, billing of willekeurige send-endpoints. Soft-404 en form-submission incidents gebruiken dezelfde templates; de problemregel komt uit de centrale error-formatter. Testdata uit form submissions zit nooit in de alert. Receipt-timeouts gebruiken dezelfde outbox; de copy is “Lead delivery could not be confirmed”, niet “Form is down”. PENDING receipts sturen geen alert. Recovery na een volgende `RECEIVED` test: “Lead delivery confirmed again”. Google Ads destination alerts noemen enabled ad references en campagnes, nooit OAuth- of developer-tokens. Opened alerts wachten niet op spend-cijfers (`Impact calculation: Pending`). Resolved alerts mogen provisional spend tonen als die al berekend is. Spend-updates sturen geen extra e-mail.
