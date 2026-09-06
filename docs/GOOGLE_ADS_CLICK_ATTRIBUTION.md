# Google Ads click attribution

Fase 17 resolved **vroeg** welke Google Ads campaign een GCLID leverde. Dit is read-only. Er is geen campaign-guessing.

## ClickView (Google Ads API v25)

Officiële resource: [`click_view`](https://developers.google.com/google-ads/api/fields/v25/click_view).

Actuele constraints (geverifieerd 31 aug 2026):

- query van **één dag**: `WHERE segments.date = 'YYYY-MM-DD'`;
- historische lookback **90 dagen**;
- GCLID is filterable (`click_view.gclid IN (...)`);
- batch per `customerId` + candidate local date;
- geen 90 losse queries per GCLID.

LeadGuard bepaalt de candidate date uit `AttributionTouch.capturedAt` in `GoogleAdsCustomer.timeZone`. Alleen bij middernacht-rand (uur ≤ 1 of ≥ 22) wordt **één** aangrenzende lokale dag geprobeerd. Daarna `NOT_FOUND`.

Als de click ouder is dan de ClickView-lookback vóór resolutie: `OUTSIDE_LOOKBACK`. Geen infinite retry.

## Wat wordt opgeslagen

`GoogleAdsLeadAttributionResolution` (unique `leadId`) verwijst naar de encrypted primary `AttributionTouch`. Geen raw GCLID/GBRAID/WBRAID.

Bij een unieke ClickView-hit:

- `status = CAMPAIGN_RESOLVED`
- `resolutionMethod = GCLID_CLICK_VIEW`
- stabiele `campaignId` (rename wijzigt de identity niet)
- optioneel ad group / ad / keyword snapshots voor later, zonder keyword-ROAS-dashboard

`capturedAt` is LeadGuard acquisition time. `googleClickDate` is Google's reporting date wanneer ClickView die levert. Een gebookmarkte URL met oude GCLID mag die twee laten verschillen.

## GBRAID / WBRAID

ClickView koppelt braid-identifiers **niet** betrouwbaar aan een campaign. LeadGuard:

- mag de lead op **accountniveau** meenemen via de expliciete Website → Ads customer mapping;
- zet campaign op `UNSUPPORTED_IDENTIFIER` / unresolved;
- gokt niet via Final URL, Performance Max asset group, spend-proportie of landing-page overlap.

## GCLID not found

Account-level attribution via Website mapping blijft mogelijk. Campaign blijft unresolved. Twee campaigns met dezelfde Final URL krijgen die click **niet**.

## Trigger

Nieuwe Google-attributed Lead + actieve analytics-mapping → enqueue `google_ads.click_attribution.resolve`. Niet wachten tot WON.

Bestaande leads: OWNER/ADMIN start een bounded backfill binnen de ClickView-lookback. Geen stille onbeperkte historical scan.

## Privacy

Resolution volgt Lead-deletion (cascade). Google performance-aggregates blijven account reporting. Logs/UI tonen geen raw click IDs.
