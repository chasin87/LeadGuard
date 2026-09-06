# Revenue attribution foundation

Fase 13 legt de attribution-keten vast voor **echte websitebezoekers**:

```text
Google Ads click
↓
gclid / gbraid / wbraid
↓
anonymous visitor + session
↓
AttributionTouch
↓
expliciete Lead
↓
LeadAttribution
```

LeadGuard slaat identifiers op, koppelt ze aan een Lead, en stopt daar. Er is geen won/lost, omzet, CRM, ROAS of Google conversion upload.

## Domein

| Model                   | Rol                                                                        |
| ----------------------- | -------------------------------------------------------------------------- |
| `WebsiteTrackingConfig` | Opt-in per Website. Standaard afwezig / uit.                               |
| `AttributionVisitor`    | Random first-party browser-id. Geen PII, geen fingerprint.                 |
| `AttributionSession`    | Activiteit binnen de session timeout (default 30 minuten).                 |
| `AttributionTouch`      | Immutable acquisition-touch. Nieuwe Google-click = nieuwe rij.             |
| `AttributionToken`      | Opaque `lgat_…` mapping naar visitor/session. Geen click IDs in het token. |
| `Lead`                  | Minimale lead (id, website, bron, timestamp). Geen naam/e-mail/telefoon.   |
| `LeadAttribution`       | 1-op-1 snapshot: first touch + primary touch.                              |

Tracking staat **niet** aan voor bestaande Websites. OWNER/ADMIN moet het expliciet enablen.

## Attribution model

LeadGuard gebruikt intern **last eligible paid touch** als primary, en bewaart daarnaast first touch.

Eligible:

1. touch ligt op of vóór `lead.occurredAt`
2. touch is niet expired t.o.v. het attribution window
3. Website/Organization matchen
4. de meest recente eligible paid touch (GCLID/GBRAID/WBRAID) wint

Een latere Google-click wijzigt een **bestaande** LeadAttribution niet. Cross-device stitching bestaat niet: desktop en mobiel zijn verschillende visitors.

Dit is **niet** hetzelfde als Google Ads reporting attribution. Een toekomstige exporter vertaalt LeadGuard-data naar de dan actuele Google-interface.

## Click identifiers

GCLID, GBRAID en WBRAID zijn opaque strings (max 512 printable ASCII). LeadGuard:

- bewaart alle aanwezige identifiers (geen one-of constraint)
- wijzigt case of inhoud niet
- versleutelt ze at rest met een HKDF-derived key (`click-id-aes-v1`) uit `CREDENTIAL_ENCRYPTION_KEY`
- houdt HMAC-hashes bij voor lookup
- logt alleen `hasGclid=true`, nooit de raw waarde
- zet ze niet in cookies of hidden fields

Google Ads click-import gebruikt doorgaans een eigen window (vaak ~90 dagen voor GCLID; GBRAID/WBRAID zijn case-sensitive). **LeadGuard data retention** en **Google conversion import window** zijn aparte concepten. Fase 13 uploadt niets.

## Consent

Default `REQUIRED`. De SDK persistt cookies, sessions en attribution pas na:

```js
LeadGuard.setConsent({ attribution: "granted" });
```

Bij `unknown` blijven click IDs alleen in JavaScript-geheugen. Bij `denied` worden LeadGuard-cookies gewist. Als de bezoeker vertrekt vóór consent, mag attribution verloren gaan — dat is bewust.

`EXTERNAL` bestaat voor klanten die een andere rechtsgrond claimen; de SDK eist nog steeds een expliciete grant. LeadGuard doet geen juridische uitspraak en reverse-engineert geen CMP.

## Lead capture

Een DOM `submit` is **geen** Lead. Alleen:

- `LeadGuard.trackLead({ eventId, externalLeadId? })` na succes
- `POST /api/tracking/v1/leads` met Bearer server secret + attribution token

`eventId` is verplicht en uniek per Website. Retries maken geen tweede Lead. `externalLeadId` is uniek per `(websiteId, source)` wanneer gezet.

Server API met geldig token finaliseert attribution direct. Expired token: Lead mag bestaan met status `EXPIRED`. Token Website A + secret Website B: reject.

## Synthetic monitors

Browser- en Form-workers zetten `window.__LEADGUARD_MONITORING__ = true` en sturen `X-LeadGuard-Monitor: 1`. De SDK no-op’t op de window-flag. HTTP/`AD_DESTINATION`-checks voeren geen browser-SDK uit.

Synthetische testsubmissions uit Fase 9/10 zijn geen commerciële Leads.

## Retention en deletion

Scheduler-tick:

- expired unused tokens
- expired touches die niet aan LeadAttribution hangen
- expired visitors zonder Leads

Leads worden **niet** op dezelfde korte termijn verwijderd. Domainfuncties `deleteVisitorTrackingData` en `deleteLeadTrackingData` ondersteunen latere privacy-verwijdering. Organization-delete cascaderen alle trackingrijen, inclusief `LeadOutcome` en events.

## Performance

Ingestion is een directe, geïndexeerde write. Geen Google API, Incident Engine of Ads-sync op het trackingpad. Rate limiting gebruikt de bestaande in-memory limiter (per proces; zie [Security](SECURITY.md)).

## Wat Fase 13 niet bouwt

Won/lost, revenue, CRM, CSV-import, offline conversions, Data Manager writes, enhanced conversions, conversion adjustments, Meta click IDs, cross-device stitching, fingerprinting, heatmaps, session replay. Status en realized revenue staan in Fase 14: [Lead & revenue data layer](LEAD_REVENUE_DATA_LAYER.md). Externe outcome-ingest (API/HMAC/CSV) staat in Fase 15: [Outcome ingestion API](OUTCOME_INGESTION_API.md). Google conversion feedback staat in Fase 16: [Google Ads conversion feedback](GOOGLE_ADS_CONVERSION_FEEDBACK.md). Acquisition-cohort Real ROAS staat in Fase 17: [Revenue analytics](REVENUE_ANALYTICS.md).
