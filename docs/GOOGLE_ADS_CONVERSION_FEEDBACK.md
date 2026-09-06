# Google Ads conversion feedback

Fase 16 koppelt een **Google Ads-geattribueerde WON-lead** terug naar Google Ads als offline conversion via de **Google Data Manager API**. Destination monitoring (Fase 11) blijft read-only.

```text
Google Ads click
↓
GCLID / GBRAID / WBRAID
↓
Lead + LeadAttribution
↓
LeadOutcome = WON (wonAt + realized revenue)
↓
eligibility
↓
GoogleAdsConversionExport (stable transactionId)
↓
Data Manager events.ingest
↓
requestStatus.retrieve
↓
SUCCEEDED / REJECTED / OUT_OF_SYNC
```

## Current Google API choice (verified 31 Aug 2026)

LeadGuard uses the official Data Manager API **v1**, not the legacy Google Ads `ConversionUploadService.UploadClickConversions`.

Verified official docs:

- [events.ingest](https://developers.google.com/data-manager/api/reference/rest/v1/events/ingest) — `POST https://datamanager.googleapis.com/v1/events:ingest`
- [requestStatus.retrieve](https://developers.google.com/data-manager/api/reference/rest/v1/requestStatus/retrieve) — `GET https://datamanager.googleapis.com/v1/requestStatus:retrieve?requestId=`
- [Destination](https://developers.google.com/data-manager/api/reference/rest/v1/Destination) — `operatingAccount` + optional `loginAccount`, `accountType` (not deprecated `product`), `productDestinationId` = Conversion Action ID
- [Diagnostics](https://developers.google.com/data-manager/api/devguides/diagnostics) — HTTP 200 + `requestId` means received, not processed; poll with backoff; processing can take up to 24 hours
- Google Ads API v25 GAQL `conversion_action` (read-only discovery)

Legacy `UploadClickConversions` is **not** used. Data Manager Event has `lastUpdatedTimestamp`, but official Data Manager docs do **not** describe a supported restatement/retraction API for offline conversions. Conversion adjustments remain a Google Ads API (`UploadConversionAdjustments`) concern. LeadGuard does **not** fall back to that write path. After a successful export, outcome/revenue changes become `OUT_OF_SYNC`.

## OAuth

Ads read stays `https://www.googleapis.com/auth/adwords`.

Conversion ingest requires `https://www.googleapis.com/auth/datamanager`.

Existing Ads connections do **not** silently gain Data Manager access. UI: _Additional Google permission required_ → _Enable conversion feedback_ → user consent for both scopes → encrypted refresh token is replaced on the **same** `GoogleAdsConnection`. Customers, destinations, incidents and impact history are kept.

Granted scopes are persisted (`grantedScopes`). Ads read and Data Manager write are separate capabilities. Destination monitoring can keep working if Data Manager is missing.

Data Manager is a sensitive Google scope. Production may require Google OAuth verification / consent-screen configuration. LeadGuard does not perform that verification.

## Mapping

OWNER/ADMIN maps explicitly:

```text
Website → GoogleAdsCustomer → Conversion Action
```

LeadGuard never guesses the advertiser account from a GCLID. Conversion Actions are discovered read-only (`UPLOAD_CLICKS` + `ENABLED`). LeadGuard never creates, updates or bidding-includes a conversion action.

Event source (`WEB` / `PHONE` / `OTHER` / …) is configured explicitly. Default UI value is `OTHER`. Lead source is not inferred as event source.

Value policy:

- `REVENUE_IF_AVAILABLE` — send realized revenue when present
- `REQUIRE_REVENUE` — block until revenue exists
- `NO_VALUE` — send conversion without LeadGuard value

Money stays integer minor units internally. Only the Data Manager JSON boundary serializes a canonical decimal to `conversionValue`.

## Eligibility

An export record is created only when:

- primary attribution has GCLID, GBRAID and/or WBRAID
- outcome is WON
- conversion feedback config is ACTIVE

Organic/direct WON, QUALIFIED and LOST do not create exports. Enabling feedback does not backfill historical WON leads.

Conversion timestamp is `LeadOutcome.wonAt` (RFC3339 Z), not lead creation time.

Click IDs are decrypted only in the worker at the provider boundary. Raw IDs are not stored on export rows, not shown in UI, and not logged. Official `AdIdentifiers` allows gclid, gbraid and wbraid together; LeadGuard sends every captured identifier.

No `userData`, hashed email/phone, or Google `consent` field is sent. LeadGuard attribution consent is not mapped to `adUserData` / `adPersonalization`.

## Export lifecycle

```text
READY → SUBMITTING → PROCESSING → SUCCEEDED
                              ↘ REJECTED / NEEDS_REVIEW
```

One LeadGuard event = one Data Manager ingest request (no batching). `transactionId` is `lgc_<32 hex>` and never changes after first persist. Once `dataManagerRequestId` exists, LeadGuard only polls status.

Ambiguous network (request may have been accepted): retry the same transaction ID. Duplicate transaction ID on our own retry is treated as idempotent success-equivalent; unexpected duplicates become `NEEDS_REVIEW`.

Invalid identifiers and event-too-old are permanent rejects. `TOO_RECENT_CLICK` / `CLICK_NOT_FOUND` get bounded delayed retry per documented processing reasons.

Delivery semantics: at-least-once attempts + stable Google transaction ID + LeadGuard persistent idempotency. Not exactly-once.

## Corrections

Data Manager does not officially support retract/restate for this ingest path. After Google has accepted/processed an event:

- revenue change → `OUT_OF_SYNC` / `REVENUE_CHANGED_AFTER_EXPORT`
- WON → LOST → `OUT_OF_SYNC` / `OUTCOME_REVERSED_AFTER_EXPORT`

No second conversion is uploaded.

Before submit, pending snapshots refresh to current truth; WON → LOST/QUALIFIED cancels the export.

## Retention and privacy

Anonymous unlinked touches keep normal tracking retention. Touches linked via `LeadAttribution` are not deleted by anonymous cleanup while the lead exists. Privacy deletion cancels unsubmitted exports and does not send to Google.

## Production setup (manual, outside this repo)

1. Enable **Data Manager API** in Google Cloud.
2. Add Data Manager OAuth scope on the existing OAuth client (keep Ads scope).
3. Complete Google OAuth verification if Google requires it for `datamanager`.
4. Ask existing Ads users to reconnect for conversion feedback.
5. Create/import a suitable offline (`UPLOAD_CLICKS`) conversion action in Google Ads.
6. In LeadGuard, map Website → advertiser account → conversion action, then activate.

Do not create conversion actions, accept enhanced-conversion terms, or mutate campaigns from LeadGuard.

## Estimated API usage

MVP sends one ingest + a handful of status polls per conversion. At 100–10,000 conversions/day this stays within a simple concurrency cap (default 5) plus client backoff on 429/5xx. Batching is deliberately not implemented.

Conversion feedback success/rejection does **not** change LeadGuard realized revenue. Fase 17 shows export health as a separate card on the revenue dashboard.
