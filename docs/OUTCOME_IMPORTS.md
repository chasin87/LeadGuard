# Outcome file imports

CSV (UTF-8, BOM toegestaan) en XLSX voor het bijwerken van bestaande Leads. Macros en formulecellen worden niet uitgevoerd.

## Limits

| Limit           | Waarde          | Reden                                          |
| --------------- | --------------- | ---------------------------------------------- |
| Bestandsgrootte | 10 MB           | Voorkomt request/worker-OOM                    |
| Rijen           | 50.000          | Gebounded batching, geen unbounded spreadsheet |
| Preview         | eerste 20 rijen | UI-snapshot, geen source of truth              |

Niet-gemapte kolommen (inclusief naam/e-mail/telefoon) worden **niet** opgeslagen.

## Flow

```text
Upload → parse headers → map columns → map status values → preview
→ dry-run (geen Outcome-mutatie) → confirm → queue `outcome.import.process`
→ bounded batches → results
```

Confirm is idempotent (`importId` + `rowNumber` en `sourceEventId`). Een crash hervat vanaf `processedRows`. Zelfde bestand opnieuw uploaden is een **nieuwe** import; stale/order-regels voorkomen overwrite van nieuwere outcomes.

## Mapping

Mappable: `externalLeadId`, `publicLeadId`, `sourceRecordId`, `sourceEventId`, `status`, `effectiveAt`, `revenueAmount`, `revenueCurrency`.

Minimaal één matchingkolom: external, public, of source record.

Statuswaarden uit het bestand (`Sold`, `Rejected`, …) mapt de gebruiker naar `NEW`/`QUALIFIED`/`WON`/`LOST`. Unmapped → rij `REJECTED`. Geen guessing.

Revenue via `parseMoney`. Als de file geen currencykolom heeft mag de organization-default **alleen** na een expliciete UI-checkbox.

Ontbreekt `effectiveAt`, dan moet de user kiezen voor import-timestamp (met waarschuwing). Geen stille aanname.

`sourceEventId` uit de file, anders `import:{importId}:{rowNumber}`.

Source op `LeadOutcomeEvent`: `CSV_IMPORT`.

## XLSX policy

- Alleen de eerste worksheet, primitive/cached cell values.
- Cellen met `<f>` (formules) of een waarde die met `=`, `+`, `-`, `@` begint: hele file/rij rejected.
- `xl/vbaProject.bin` (macros): file rejected.
- Geen formula-engine, geen external links, geen embedded objects.

## Opslag

Private `ArtifactStorage` key `outcome-imports/{organizationId}/{importId}/…`. Niet publiek. Raw file retention 30 dagen (scheduler). Normalized import history blijft langer.

## Permissions

Upload/confirm: `leads:manage` + `integrations:manage` (OWNER/ADMIN). MEMBER mag history/read.
