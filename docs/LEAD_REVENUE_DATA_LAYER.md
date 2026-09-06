# Lead & revenue data layer

Fase 14 voegt een provider-onafhankelijke **business outcome-laag** toe bovenop Fase 13 capture:

```text
Lead                 ← er is een echte lead ontstaan
└── LeadAttribution  ← welke click/session (immutable)
└── LeadOutcome      ← huidige salesstatus + realized revenue
    └── LeadOutcomeEvent  ← immutable audit
```

Lead Receipt Verification blijft testdelivery. Outcome zegt of een commerciële lead gekwalificeerd, gewonnen of verloren is. Die twee concepten mogen niet worden verward.

## Status

| Status      | Betekenis                                        |
| ----------- | ------------------------------------------------ |
| `NEW`       | Ontvangen, nog niet gekwalificeerd. Default.     |
| `QUALIFIED` | Het bedrijf vindt de lead verkoopwaardig.        |
| `WON`       | De lead heeft tot een gewonnen deal geleid.      |
| `LOST`      | De lead heeft niet tot een gewonnen deal geleid. |

LeadGuard schrijft niet voor hoe een bedrijf kwalificeert. Nieuwe Leads (en bestaande Fase 13-leads via backfill) krijgen `LeadOutcome(status=NEW)`.

Toegestane transitions: `NEW`/`QUALIFIED` naar elke andere status. `WON`/`LOST` mogen worden gecorrigeerd of gereactiveerd (`LOST → WON` is geldig) maar vereisen `confirmTerminalTransition=true`. Zelfde status + dezelfde revenue is een no-op.

## Effective timestamps

Elke mutatie heeft `effectiveAt` (wanneer de businessstatus veranderde) en `createdAt` op het event (wanneer LeadGuard het registreerde). Manual UI default is now. OWNER/ADMIN mag backdaten, niet vóór `Lead.occurredAt` (5 minuten skew) en niet significant in de toekomst (zelfde skew).

Huidige `qualifiedAt` / `wonAt` / `lostAt` volgen de **huidige** status. Eerdere momenten blijven in de event history.

## Revenue

Realized deal-/omzetbedrag voor een **WON** lead. Geen pipeline, quotation of predicted value.

- WON zonder bedrag is geldig (`Revenue not entered`).
- `NEW` / `QUALIFIED` / `LOST` mogen geen current revenue hebben.
- `WON → LOST` wist current revenue; de oude waarde blijft in `LeadOutcomeEvent`.
- `LOST → WON` restore’t **niet** automatisch het oude bedrag.
- `0` is een echt nulpunt; `null` is unknown.
- Negatieve bedragen, refunds en adjustments zitten niet in Fase 14.

Currency is ISO 4217, opgeslagen in minor units (`revenueAmountMinor`) plus `revenueCurrencyCode`. Geen JS-floats als source of truth, geen stille EUR-default, geen Google Ads customer-currency inferentie, geen optelling over currencies. Organisatie mag `defaultRevenueCurrencyCode` zetten als UI-prefill.

## Source en actor

`LeadOutcomeSource`: `MANUAL`, `API`, `CSV_IMPORT`, `CRM_SYNC`, `SYSTEM`. Fase 15 gebruikt `API` (server-to-server / webhook) en `CSV_IMPORT` (file). `CRM_SYNC` blijft gereserveerd tot een native connector. Alle inputs gaan door `applyLeadOutcomeMutation`.

Nullable `sourceSystem` / `sourceRecordId` / `sourceEventId` bestaan al op events voor latere CRM-matching. Geen provider-specifieke kolommen (`hubspotDealId`, …). `Lead.externalLeadId` blijft het Fase 13 matchingveld.

Actor komt uit de authenticated session (`USER` + `actorUserId`). Client-supplied user IDs worden genegeerd.

## Audit, concurrency, idempotency

`LeadOutcome` is current state. `LeadOutcomeEvent` is immutable; correcties zijn nieuwe events.

- `version` start op 1 en stijgt bij elke echte mutatie.
- `expectedVersion` voorkomt lost updates (`409 OUTCOME_VERSION_CONFLICT`).
- `mutationId` (UUID) is uniek per outcome: retries maken geen tweede event.

Lead + Attribution + Outcome ontstaan in één transactie. Status + revenue in één mutatie (WON + €4.500, of WON→LOST met clear) eveneens.

## Attribution

Outcome-mutaties raken `LeadAttribution` niet. Een latere Google-click van dezelfde visitor verandert een bestaande WON-lead niet.

## Permissions

`leads:read` — OWNER, ADMIN, MEMBER (read-only).  
`leads:manage` — OWNER, ADMIN.

Geen notificatie of incident bij WON/LOST. Acquisition-cohort Real ROAS leest current `LeadOutcome` (Fase 17): [Revenue analytics](REVENUE_ANALYTICS.md).

## Privacy

Geen naam, e-mail, telefoon, notes of andere PII. Lead-deletion / organization-delete cascaderen Outcome + events. Audit is geen reden om PII te bewaren; Fase 14 slaat die niet op.

Zie ook [Revenue attribution](REVENUE_ATTRIBUTION_FOUNDATION.md) en [Security](SECURITY.md).
