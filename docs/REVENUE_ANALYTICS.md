# Revenue analytics

Fase 17 maakt de commerciële keten zichtbaar **zonder fake precision**:

```text
Google Ads reported spend
↓
clicks
↓
LeadGuard-attributed leads
↓
NEW / QUALIFIED / WON / LOST
↓
LeadGuard realized revenue
↓
cost per lead / cost per won / Real ROAS
```

LeadGuard houdt drie datawerelden gescheiden:

| Wereld                             | Source of truth                                            | Voorbeelden                              |
| ---------------------------------- | ---------------------------------------------------------- | ---------------------------------------- |
| A. Google Ads reported performance | `metrics.cost_micros`, clicks, impressions via Ads API v25 | Spend, clicks                            |
| B. LeadGuard business outcomes     | `LeadOutcome.revenueAmountMinor` + currency                | WON, realized revenue                    |
| C. Google conversion feedback      | Fase 16 Data Manager exportstatus                          | Succeeded / Processing / Needs attention |

`metrics.conversions_value` is **niet** LeadGuard-revenue. Een rejected Google conversion-export verandert realized revenue niet.

## Real ROAS

Primaire metric: **acquisition cohort Real ROAS**

```text
realized revenue from Leads acquired in the cohort
/
Google Ads reported spend for that same acquisition cohort
```

Niet: omzet gewonnen deze maand / spend deze maand.

Label **Real ROAS** alleen als:

- spend beschikbaar is;
- revenue currency = spend currency;
- alle current WON leads bekende revenue hebben (inclusief expliciet €0);
- attribution-scope betrouwbaar is (geen website-spend-gok).

Anders:

- **Known-revenue ROAS** + PARTIAL bij onvolledige WON-revenue;
- **ROAS unavailable — currency mismatch** zonder FX;
- **No Google Ads spend reported** bij spend 0 (geen ∞);
- **unavailable** als er geen gesynchroniseerde spendrijen zijn (dat is niet €0).

Won-date reporting bestaat apart als _Won revenue by outcome date_ en is geen ROAS-numerator.

## Acquisition cohort

Precedence:

1. exacte Google `click_view` click date wanneer campaign-resolved;
2. anders `LeadAttribution.primaryTouch.capturedAt` in `GoogleAdsCustomer.timeZone` (IANA, inclusief DST).

`Lead.createdAt` is niet de cohort-sleutel.

## Currency

Geen FX. Multi-currency toont revenue per currency en geen gecombineerde ROAS.

Spend: `GoogleAdsCustomer.currencyCode` uit `metrics.cost_micros`.
Revenue: `LeadOutcome.revenueCurrencyCode` in minor units.

## Completeness en coverage

- Revenue completeness = WON leads met bekende revenue / current WON leads.
- Campaign attribution coverage = campaign-resolved leads / Google Ads-attributed leads.
- Unresolved campaign revenue wordt **niet** over campaigns verdeeld.
- Resolved campaign revenue + unresolved revenue = account Google-attributed revenue (zelfde cohort/currency).

## Mapping

`GoogleAdsAnalyticsConfig` koppelt een Website aan één Google Ads advertiser. Analytics vereist **geen** Data Manager write-scope. Een actieve conversion-feedback-config en analytics-config voor dezelfde Website moeten hetzelfde Ads-customer gebruiken.

Meerdere Websites mogen hetzelfde Ads-account delen; spend wordt één keer geteld. Website-filter mag leads/revenue beperken maar wijst account-spend niet toe aan één site.

## Freshness

Dashboard leest PostgreSQL, geen live Google-call per pageview.

- Recente sync: today + 7 dagen.
- Initial backfill: 90 dagen (max daily lookback 37 maanden per Google `segments.date`).
- Label: _Google Ads reported spend_, niet financially finalized.
- Outage: laatste rijen blijven; freshness Delayed/Stale/Unavailable.

Zie [Google Ads click attribution](GOOGLE_ADS_CLICK_ATTRIBUTION.md) voor ClickView.
