# Google Ads incident impact

Fase 12 hangt spend-at-risk aan bestaande `AD_DESTINATION`-incidenten. LeadGuard meet Google Ads-verkeer en advertentiekosten die aan de getroffen destination/source kunnen worden gekoppeld. Dit is geen omzetverlies en geen conversion attribution.

```text
AD_DESTINATION Incident
        ↓
GoogleAdsIncidentImpact (PENDING)
        ↓
impact job (read-only GAQL)
        ↓
timezone-aware window + attribution
        ↓
AVAILABLE | PARTIAL | UNAVAILABLE | ERROR
```

## Incident window

Impact gebruikt `Incident.startedAt` (eerste geobserveerde failure) tot `Incident.resolvedAt`, of `now` zolang het incident open is. `detectedAt` is alleen het moment waarop de threshold werd bereikt en telt niet als spend-start.

Open impact is altijd **LIVE / PROVISIONAL**: het incident loopt nog en Google Ads reporting kan later bijwerken.

## Timezone en valuta

Incident-timestamps zijn UTC. Reporting buckets gebruiken `GoogleAdsCustomer.timeZone` (IANA, DST-aware). Ontbrekende of ongeldige timezone maakt impact `UNAVAILABLE` — geen stille UTC-aanname.

Alle bedragen gebruiken `GoogleAdsCustomer.currencyCode`. Interne aggregatie is `bigint` micros (`1 unit = 1_000_000 micros`). Afronding naar currency minor units gebeurt pas bij weergave.

## Google Ads metrics (API v25)

LeadGuard blijft op dezelfde gecentraliseerde versie (`v25`). Nieuwe provider-methods zijn uitsluitend `googleAds:search`.

| Resource                     | Segment                           | Gebruik                                                                            |
| ---------------------------- | --------------------------------- | ---------------------------------------------------------------------------------- |
| `landing_page_view`          | `segments.date`                   | Destination-context per dag. **Geen** `segments.hour` (niet selecteerbaar in v25). |
| `expanded_landing_page_view` | `segments.date`                   | Observed/expanded URL-context per dag.                                             |
| `ad_group_ad`                | `segments.date` + `segments.hour` | Hourly source metrics voor eenduidige standard ads.                                |
| `asset_group`                | hourly mogelijk                   | **Niet** gebruikt voor URL-level window spend. PMax blijft conservatief.           |

Velden: `metrics.clicks`, `metrics.cost_micros`, optioneel `metrics.impressions`. Geen conversions.

Hourly lookback is begrensd (`GOOGLE_ADS_IMPACT_HOURLY_LOOKBACK_DAYS`, default 90). Dat is een productlimiet, geen garantie van Google.

## Attribution

- **SOURCE_HOURLY** — volledige uur-buckets vallen in het venster; confidence HIGH bij volledige dekking.
- **SOURCE_HOURLY_PRORATED** — eerste/laatste uur naar overlap (`cost × overlapMs / bucketMs`). Altijd estimated, confidence MEDIUM.
- **DESTINATION_REPORTED_DAILY** — landing-page dagcijfers als context. Nooit als exact 20-minuten-incidentspend.
- **MIXED** — sommige sources hourly, andere ambiguous. Status PARTIAL.
- **UNAVAILABLE** — geen betrouwbare window-attribution.

Google Ads reporting granularity differs between resources. LeadGuard only labels data as estimated when exact destination-level incident-window attribution is unavailable.

Zero clicks/cost van een geslaagde query is `AVAILABLE` met 0, niet `UNAVAILABLE`.

## Performance Max

AssetGroup-hourly spend wordt niet over URLs verdeeld (geen even split). PMax-sources zijn `AMBIGUOUS` voor window-attribution. Expanded landing-page dagcijfers mogen als context. Exact incident-window spend blijft UNAVAILABLE of PARTIAL.

## Duplicate sources

Aggregatie dedupliceert op `sourceType + sourceEntityId` (adId of assetGroupId). Dezelfde ad via configured + observed reference telt één keer.

Een ad met meerdere verschillende normalized final URLs is `AMBIGUOUS` voor elk van die destinations.

## Refresh en finalization

- Incident OPEN → PENDING row + job. Notifications wachten hier niet op.
- Open incidents: refresh elke `GOOGLE_ADS_IMPACT_REFRESH_INTERVAL_SECONDS` (default 900).
- Resolve → finalize-job. Default delay `GOOGLE_ADS_IMPACT_FINALIZE_DELAY_MINUTES` (360). Daarna optioneel reconcile na `GOOGLE_ADS_IMPACT_RECONCILE_AFTER_HOURS` (24).
- Dit zijn productdefaults, geen claim over Google reporting latency.
- `finalizedAt` maakt de snapshot stabiel tot OWNER/ADMIN **Refresh Google Ads impact** (queue, cooldown 60s, geen Google-call in de Next.js-request).
- Geen automatische backfill van historische Fase 11-incidenten. On-demand refresh kan een bestaand incident alsnog vullen.

## Historical incidents

Geen onbeperkte API-backfill. Nieuwe incidenten krijgen automatisch impact. Oudere incidenten alleen via handmatige refresh.

## Disconnect / reauth

Opgeslagen aggregatie blijft zichtbaar zonder credentials. Disconnect stopt refresh (`dataIncomplete` als finalization nog niet klaar was). `REAUTH_REQUIRED` maakt impact UNAVAILABLE zonder de website-incidenthealth te wijzigen.

## Queue

Jobs gaan naar `integration.google_ads.incident_impact` met payload `{ incidentId, reason }` en `singletonKey = incidentId`. Dezelfde Google Ads-worker verwerkt sync (concurrency 2) en impact (concurrency 1). Geen tokens in de queue.

## Known limitations

- Geen revenue loss, conversions, ROAS of lead value
- Landing-page reporting is dagelijks, niet hourly
- Hourly source attribution is estimated bij gedeeltelijke uren
- Ads met meerdere final URLs en PMax Final URL Expansion blijven ambiguous
- Google Ads reporting kan naijlen of later wijzigen; finalized impact is een snapshot
- Geen automatische backfill van historische Fase 11-incidenten
