# Google Ads destination monitoring

Fase 11 koppelt een Organization-read-only aan Google Ads, ontdekt Final URLs, en bewaakt unieke destinations met de bestaande HTTP-engine.

```text
Google OAuth
      ↓
GoogleAdsConnection
      ↓
GoogleAdsCustomer
      ↓
Google Ads Sync Worker
      ↓
 ┌───────────────┬────────────────┬─────────────────────┐
 │ ad_group_ad   │ asset_group    │ expanded landing    │
 └───────┬───────┴───────┬────────┴──────────┬──────────┘
         ↓               ↓                   ↓
              Destination References
                       ↓
               Unique Destination
                       ↓
                    Website
                       ↓
             AD_DESTINATION Monitor
                       ↓
                  HTTP Worker
                       ↓
                 MonitorCheck
                       ↓
                   Incident
                       ↓
                Notification
```

## API-versie en client

LeadGuard gebruikt **Google Ads API v25** (actuele major release op 22 juli 2026; v25.1 op 19 augustus 2026). De versie staat alleen in `src/server/google-ads/config.ts`.

Er is geen gRPC/Node Ads SDK. De live provider praat REST:

- `GET /v25/customers:listAccessibleCustomers`
- `POST /v25/customers/{id}/googleAds:search` (GAQL, paginatie)

Dat houdt de dependency-footprint klein, maakt een fake provider voor CI triviaal, en vermijdt mutate-helpers uit officiële clients.

## Read-only garantie

`GoogleAdsReadProvider` heeft alleen list/get/sync-query methodes. Er is geen `mutate`, pause, budget- of conversion-upload pad. LeadGuard bezoekt geen `tracking_url_template`, voegt geen `gclid`/`gbraid`/`wbraid` toe, en gebruikt `final_url_suffix` niet als health-target.

Zelfs bij HTTP 404 blijft Google Ads ongewijzigd.

## OAuth

OWNER/ADMIN start connect via Settings → Integrations → Google Ads.

- Scope: uitsluitend `https://www.googleapis.com/auth/adwords`
- `access_type=offline` en `prompt=consent` voor een refresh token
- State: 32 random bytes, SHA-256 in de database, expiry 10 minuten, single-use, gebonden aan organization + initiating user
- Callback (`/api/integrations/google-ads/callback`) controleert membership opnieuw (`integrations:manage`)
- Ontbrekend refresh token: connect faalt met een duidelijke reconnect-melding

MEMBER is read-only.

## Developer token

`GOOGLE_ADS_DEVELOPER_TOKEN` is een LeadGuard-platformcredential. Klanten voeren geen eigen developer token in. Het token gaat nooit naar de browser, queue of logs.

## Credential encryption

Refresh tokens staan encrypted-at-rest (AES-256-GCM, `CREDENTIAL_ENCRYPTION_KEY`, `credentialVersion`). Access tokens worden on-demand ververst en niet permanent opgeslagen. Queue payloads bevatten alleen `connectionId` en `googleAdsCustomerId`.

## Accounts en MCC

Na OAuth haalt LeadGuard accessible customers op. Manager-accounts worden gebruikt als `loginCustomerId` (cijfers, geen streepjes). Advertiser-accounts moeten expliciet geselecteerd worden. Een willekeurig customer-id invoeren is onmogelijk: selectie matcht alleen records die via OAuth zichtbaar waren.

## Destination discovery

Drie read-only GAQL-bronnen:

1. **Standard ads** — `ad_group_ad` met `ad.final_urls` en `ad.final_mobile_urls`
2. **Performance Max** — `asset_group` (alleen `PERFORMANCE_MAX`) met `final_urls` / `final_mobile_urls`
3. **Observed** — `expanded_landing_page_view.expanded_final_url` plus `segments.landing_page_source` over een begrensde lookback (`GOOGLE_ADS_OBSERVED_URL_LOOKBACK_DAYS`, default 30)

Provenance blijft bewaard (`CONFIGURED_FINAL_URL`, `CONFIGURED_MOBILE_URL`, `OBSERVED_EXPANDED_URL`). Configured URLs betekenen niet automatisch dat er gisteren clicks naartoe gingen.

## URL-handling

Google Ads-data is untrusted. Elke URL gaat door de bestaande parser, normalizer, website-boundary en SSRF-check. Query parameters blijven staan. Macros (`{campaignid}`, `{_page}`) worden niet ingevuld: die destinations krijgen `UNSUPPORTED` en geen HTTP-monitor. Private IPs en niet-http(s) schema's worden geblokkeerd.

Desktop- en mobile-URLs die na normalisatie identiek zijn, delen één `GoogleAdsDestinationTarget` en één `AD_DESTINATION`-monitor. Alle source-references blijven bestaan.

## Website approval

Bestaat de origin al als Website, dan mag LeadGuard automatisch een monitor maken. Een onbekende host blijft `NEEDS_APPROVAL` tot OWNER/ADMIN goedkeurt (volledige Fase 3-validatie) of negeert.

## Sync

Queue: `integration.google_ads.sync`. Frequentie default 15 minuten. Eén advisory lock per customer. Alleen een **volledige** succesvolle sync mag unseen sources `sourceActive=false` maken (`syncGeneration` mark-and-sweep). Een Google API-fout laat bestaande destinations door-monitoren. Auth-failures zetten de connection op `REAUTH_REQUIRED` zonder customer-incident. User pause (`AdDestinationConfig.userPaused`) wordt niet door sync ongedaan gemaakt.

Lokaal/fake provider synct in-process na accountselectie zodat de preview zonder extra worker zichtbaar is. Productie enqueue’t alleen.

## Monitoring en incidents

`AD_DESTINATION` hergebruikt de HTTP-worker, soft-404 classifier, Incident Engine en notifications. Meerdere ads naar dezelfde URL → 1 monitor → 1 incident. Alerts noemen enabled reference-count en tot drie campagnenamen. Geen spend-at-risk, geen auto-pause.

## Disconnect / reconnect

Disconnect stopt syncs, wist het encrypted refresh token, revoket best-effort bij Google, markeert sources inactive, en behoudt MonitorChecks/Incidents/historie. Reconnect hergebruikt dezelfde connection- en customer-rijen.

## Incident impact

Zie [Google Ads incident impact](GOOGLE_ADS_INCIDENT_IMPACT.md). Spend-at-risk hangt als metadata aan het bestaande Incident. LeadGuard schrijft niets terug naar Google Ads.

## Fake provider

`GOOGLE_ADS_PROVIDER=fake` is voor development/test. Productie (`NODE_ENV=production`) faalt hard als fake is geselecteerd. CI praat nooit met live Google.

## Productie-setup (buiten deze repo)

1. Google Cloud-project
2. OAuth client (web), authorized redirect URI = `GOOGLE_ADS_REDIRECT_URI`
3. Google Ads API inschakelen
4. Developer token aanvragen/laten goedkeuren
5. `CREDENTIAL_ENCRYPTION_KEY` (32 bytes, hex of base64) genereren en in de runtime zetten
6. `GOOGLE_ADS_PROVIDER=google`

## Google Ads API policy (relevant)

LeadGuard slaat alleen destination- en sourcecontext op die nodig is voor health monitoring. Geen audiences, search terms, conversion uploads of user lists. OAuth-tokens worden encrypted bewaard voor offline sync namens de autoriserende user. Zie de actuele [Google Ads API-documentatie](https://developers.google.com/google-ads/api/docs/start) voor developer-token- en data-use regels.
