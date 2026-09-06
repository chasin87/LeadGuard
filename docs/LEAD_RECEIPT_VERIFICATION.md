# Lead receipt verification

Form success betekent dat de website de testsubmission accepteerde. Receipt success betekent dat LeadGuard bewijs kreeg dat de testlead op een geconfigureerd downstream-punt aankwam.

```text
Browser
↓
Form
↓
Submit
↓
Website accepts          ← FORM SUCCESS (MonitorCheck, immutable)
↓
External lead processing
↓
Email / webhook receipt
↓
LeadGuard confirms       ← RECEIPT SUCCESS (LeadReceiptVerification)
```

Dit bewijst **niet** dat een medewerker de lead heeft gezien, dat het CRM een factuur maakte, of dat sales heeft gebeld. Alleen dat het geconfigureerde receipt-punt is bereikt.

## Methoden

Per FORM-monitor, optioneel:

| Mode              | Default | Wanneer                                                                 |
| ----------------- | ------- | ----------------------------------------------------------------------- |
| `NONE`            | ja      | Alleen form success, zoals Fase 9                                       |
| `INBOUND_EMAIL`   | nee     | Bevestigingsmail naar `receipt+{{submissionId}}@{INBOUND_EMAIL_DOMAIN}` |
| `RECEIPT_WEBHOOK` | nee     | Authenticated POST naar `/api/receipts/webhook`                         |

Bestaande FORM-monitors blijven `NONE`. Receipt aanzetten wist `receiptVerifiedAt` en pauzeert een ACTIVE monitor tot een nieuwe end-to-end receipt slaagt.

## Lifecycle

```text
Form submission CONFIRMED
↓
LeadReceiptVerification PENDING
↓
receipt binnen timeout     → RECEIVED  → health OPERATIONAL
geen receipt               → TIMED_OUT → synthetic FAILURE LEAD_RECEIPT_TIMEOUT
late receipt na timeout    → TIMED_OUT blijft, lateReceipt=true
```

`MonitorCheck` blijft het meetresultaat van de form run. LeadGuard herschrijft SUCCESS niet naar FAILURE. Timeout maakt een **aparte** `MonitorCheck` met `LEAD_RECEIPT_TIMEOUT` en voedt de bestaande Incident Engine.

Race (timeout-job en callback tegelijk): `SELECT … FOR UPDATE` op de verification-rij. De eerst gecommitte terminal state wint. Als de rij nog `PENDING` is en `receivedAt <= timeoutAt`, wint `RECEIVED`.

Late receipts lossen een open incident **niet** automatisch op. Recovery vereist de volgende geplande/handmatige test met `RECEIVED`.

## Correlation

Voorkeursvolgorde:

1. optioneel form field `LEADGUARD_SUBMISSION_ID` (hidden/text mapping)
2. inbound recipient plus-address `receipt+LG-…@…`
3. marker `[LEADGUARD TEST LG-…]` in message/subject/body

Geen fuzzy matching. `submissionId` is `LG-YYYYMMDD-` plus 12 tekens uit een ambiguïteitsarme alphabet (geen I/O/0/1).

Inbound email vult het EMAIL-veld met het gegenereerde receipt-adres. Dat werkt alleen als de klantworkflow écht een mail naar dat adres kan sturen (auto-confirm, testrouting, of CRM-notification). Niet iedere site is compatibel.

Webhook/Make/Zapier/n8n: stuur `submissionId` mee vanuit het form field of de message marker.

```json
POST /api/receipts/webhook
Authorization: Bearer lgrw_…
Content-Type: application/json

{ "submissionId": "LG-20260830-ABCDEFGHJKMN" }
```

Antwoord is altijd generiek (`202 accepted` of `401` zonder enumeratie van bestaande IDs). Secret van organisatie A kan submission B niet bevestigen.

## Timeout

De scheduler scant due rows (`status=PENDING AND timeoutAt <= now`) via index `(status, timeoutAt)`. Geen `setTimeout` in het webproces. Restarts verliezen pending verifications niet.

Per FORM-monitor maximaal één actieve scheduled submission/receipt. Scheduler en form-runner skippen overlap. Per-host FORM-lock blijft.

Als inbound email **niet** geconfigureerd is, worden `INBOUND_EMAIL`-timeouts overgeslagen (geen klantincident door LeadGuard-misconfig). Een echte provider-outage terwijl config “ready” lijkt, kan nog steeds een false timeout geven; dat is een bekende beperking.

## Inbound email

LeadGuard is geen mailserver. Een externe provider (Postmark inbound, Mailgun routes, SendGrid inbound parse, SES inbound) POSTed naar:

```text
POST /api/inbound/email/{provider}
```

`provider` moet gelijk zijn aan `INBOUND_EMAIL_PROVIDER` (`generic` in productie, `dev` alleen buiten productie). Auth: Bearer-secret of HMAC (`X-LeadGuard-Timestamp` + `X-LeadGuard-Signature`, zelfde schema als outbound notification webhooks). Body-limiet 256 KiB. Attachments worden genegeerd en nooit gedownload. Er wordt geen HTML/text-body opgeslagen — alleen `providerMessageId`, recipient, sender-domein, truncated subject.

Productiesetup (DNS zelf uitvoeren):

```text
MX / inbound route bij de mailprovider
↓
provider webhook → LeadGuard /api/inbound/email/generic
↓
INBOUND_EMAIL_DOMAIN + INBOUND_EMAIL_WEBHOOK_SECRET
```

## Activering

```text
Validate form (geen submit)
↓
Configure receipt workflow
↓
Send real test lead
↓
Waiting for receipt (polling op de detailpagina)
↓
Receipt confirmed → receiptVerifiedAt
↓
Enable scheduled tests
```

Geen “mark as working”-knop. MEMBER is read-only; OWNER/ADMIN wijzigen config en rotaten het webhook-secret (plaintext één keer).

## Health

| Situatie                         | Health                            |
| -------------------------------- | --------------------------------- |
| Submit failed                    | failing / down                    |
| Submit success, receipt PENDING  | `pending_confirmation`            |
| Submit success, receipt RECEIVED | operational                       |
| Receipt timeout                  | failing, daarna down na threshold |

Zie ook [Incidents](INCIDENTS.md) en [Form monitoring](FORM_MONITORING.md). Google Ads click/cost impact (spend-at-risk) is Fase 12. Echte visitor-leads en click-ID attribution zijn Fase 13 en staan los van receipt verification.
