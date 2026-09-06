# Outcome ingestion API (v1)

Generic server-to-server API om **bestaande** Leads te muteren. Er is geen tweede status-engine: ieder event eindigt in `applyLeadOutcomeMutation()`.

Base: `/api/outcomes/v1/`

| Endpoint                             | Functie                                        |
| ------------------------------------ | ---------------------------------------------- |
| `POST /api/outcomes/v1/events`       | Eén event, synchroon                           |
| `POST /api/outcomes/v1/events/batch` | 1–100 events, per row resultaat, geen rollback |
| `POST /api/outcomes/v1/validate`     | Schema + matching/freshness, geen mutatie      |

Body-limiet: 256 KiB. Breaking changes komen in `/v2/`.

## Auth

Twee modi per integration (niet allebei):

**Bearer**

```http
Authorization: Bearer lgoi_<64 hex>
```

Het plaintext secret wordt één keer getoond, daarna alleen `lgoi_abcd••••`. Alleen de SHA-256-hash staat in de database. Tracking `lg_site_` / `lgsrv_` keys werken hier niet.

**HMAC**

```http
X-LeadGuard-Integration: <integrationId>
X-LeadGuard-Event-Id: crm-event-98213
X-LeadGuard-Timestamp: 1756647780
X-LeadGuard-Signature: sha256=<hex>
```

Signature: `HMAC-SHA256(signingSecret, timestamp + "." + rawBody)` (zelfde helper als outbound webhooks). Timestamp unix seconden of milliseconden, venster ±5 minuten. Replay van hetzelfde `eventId` is idempotent (geen tweede `LeadOutcomeEvent`).

Credential-rotatie: nieuwe `lgoi_`-waarde, oude hash blijft `credentialRotationGraceMinutes` (default 60) geldig. HMAC signing secret roteert **direct**.

## Payload

```json
{
  "eventId": "crm-event-98213",
  "externalLeadId": "quote_123",
  "publicLeadId": "lgl_…",
  "sourceRecordId": "deal_5543",
  "sourceVersion": 12,
  "status": "WON",
  "effectiveAt": "2026-08-31T14:23:00Z",
  "revenue": { "amount": "4500.00", "currency": "EUR" }
}
```

- `eventId` is verplicht (externe idempotency key).
- `status` is alleen `NEW` | `QUALIFIED` | `WON` | `LOST`. Geen `CLOSED_WON`.
- Revenue: dezelfde Fase 14-parser (`parseMoney`). Alleen WON mag realized revenue hebben. `0.00` is geldig. Negatief is ongeldig. Currency verplicht bij amount. Geen floats, geen conversie.
- `effectiveAt` is business time. Significant in de toekomst of vóór `Lead.occurredAt` (5 min skew) wordt afgewezen.
- `sourceVersion` is optioneel en fungeert als tiebreaker bij dezelfde `effectiveAt`.

Batch:

```json
{ "events": [{ "eventId": "…" }, { "eventId": "…" }] }
```

of een kale array. Per item: `APPLIED` | `DUPLICATE` | `UNMATCHED` | `STALE` | `CONFLICT` | `REJECTED` | `AMBIGUOUS`.

## Matching

Exact, nooit fuzzy, nooit op PII:

1. Bestaande `ExternalLeadLink` (`integrationId` + `sourceRecordId`)
2. `externalLeadId` binnen de websites die de integration mag matchen
3. `publicLeadId` in dezelfde organization én allowed website
4. Anders `UNMATCHED` — er wordt **geen** Lead aangemaakt

Meerdere exacte hits → `AMBIGUOUS`. Source record al gekoppeld aan een andere Lead → `CONFLICT` (geen stille remap).

## Ordering

Business `effectiveAt` (niet `receivedAt`). Ouder dan de huidige outcome → `STALE`. Zelfde timestamp + andere state zonder hogere `sourceVersion` → `CONFLICT`. Trusted integrations mogen WON↔LOST corrigeren; `actorType` is altijd server-side `INTEGRATION`.

## Fouten

HTTP 401 (ongeldige credential/signature), 403 (disabled), 413 (payload), 429 (rate limit). Business-resultaten blijven 200 met `errorCode`:

`INVALID_STATUS`, `INVALID_REVENUE`, `INVALID_CURRENCY`, `INVALID_EFFECTIVE_AT`, `LEAD_NOT_FOUND`, `AMBIGUOUS_MATCH`, `SOURCE_RECORD_ALREADY_LINKED`, `STALE_EVENT`, `OUTCOME_VERSION_CONFLICT`, `INTEGRATION_DISABLED`.

Rate limits (per minuut, in-process): credential 300, organization 600, IP 120. Env: `OUTCOME_API_RATE_LIMIT`, `OUTCOME_ORG_RATE_LIMIT`, `OUTCOME_IP_RATE_LIMIT`.

Logs bevatten geen bearer token, signing secret, signature, click IDs of revenuebedragen.

Applied WON events gebruiken dezelfde asynchrone Google conversion planner als handmatige WON (Fase 16). De ingest-request belt Google niet.
