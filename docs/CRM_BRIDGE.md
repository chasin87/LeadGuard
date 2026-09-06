# CRM bridge

Fase 15 bouwt een **provider-onafhankelijke** ingestielaag. Native HubSpot / Pipedrive / Teamleader / Salesforce / Exact-connectors horen bij latere fases.

```text
Native CRM connector (toekomst)
        ↓
provider adapter  (HubSpot payload → NormalizedExternalOutcomeEvent)
        ↓
ExternalOutcomeIngestionService
        ↓
exact Lead matcher + ExternalLeadLink
        ↓
freshness / conflict
        ↓
applyLeadOutcomeMutation()
        ↓
LeadOutcome + LeadOutcomeEvent
```

`ExternalOutcomeAdapter` normaliseert naar:

- `sourceSystem` / `sourceRecordId` / `sourceEventId` / optioneel `sourceVersion`
- `externalLeadId` / `publicLeadId`
- `status` (`NEW`|`QUALIFIED`|`WON`|`LOST`)
- `effectiveAt`
- `revenueAmount` + `revenueCurrency` (Fase 14 money helpers)

`LeadOutcomeService` mag geen `if (HubSpot)` bevatten. Connectors mogen later **niet** rechtstreeks `LeadOutcome` updaten.

Generic ingestion (API / webhook / file) gebruikt `source = API` of `CSV_IMPORT`. `CRM_SYNC` is gereserveerd tot er een echte native adapter is.

Persistent mapping: `ExternalLeadLink` (`integrationId` + `sourceRecordId` → Lead). Eerste match koppelt; latere events zonder `externalLeadId` hergebruiken de link. Stille remap is verboden.

Unmatched events blijven staan voor exacte OWNER/ADMIN-reconciliation. Geen fuzzy PII-search, geen auto-create Lead.

Een genormaliseerde WON via deze bridge is identiek aan een handmatige WON voor Google conversion feedback. De bridge zelf stuurt niets naar Google.
