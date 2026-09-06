# Tracking SDK

De LeadGuard Tracking SDK is een kleine, versie-vaste JavaScript-bundle voor klantwebsites. Doel: consent, click IDs, anonymous visitor/session, attribution token, expliciete lead-bevestiging. Geen analyticsproduct.

## Installatie

```html
<script
  defer
  src="https://<APP_URL>/tracker/v1.js"
  data-site-key="lg_site_..."
></script>
```

`APP_URL` is de publieke LeadGuard-origin (`TRACKING_PUBLIC_BASE_URL` of `APP_URL`). Het pad `/tracker/v1.js` is immutable; breaking changes gaan naar `/tracker/v2.js`.

De public site key is een **identifier**, geen secret. Hij staat in HTML. Server-to-server calls gebruiken een apart `lgsrv_…` secret (alleen hash in de database, één keer zichtbaar na create/rotate).

LeadGuard kan het snippet niet automatisch op een externe site plaatsen.

## Lifecycle

```text
parse data-site-key
↓
no-op als window.__LEADGUARD_MONITORING__
↓
lees gclid/gbraid/wbraid uit URLSearchParams
↓
wacht op consent
↓
visitor/session cookies
↓
POST /api/tracking/v1/events
```

De SDK herschrijft de klant-URL niet (`history.replaceState` blijft ongebruikt). Fail-open: trackingfouten mogen het formulier niet blokkeren.

## Consent

```js
LeadGuard.setConsent({ attribution: "granted" });
LeadGuard.setConsent({ attribution: "denied" });
await LeadGuard.ready();
```

`ready()` is een Promise die resolve’t zodra `window.LeadGuard` is gezet. Roep consent pas daarna aan als het script async/defer geladen is.

Tot grant: geen cookies, geen netwerk, click IDs alleen in memory. Denied wist `_lg_vid`, `_lg_sid` en `_lg_tok`.

Google Consent Mode / GTM / dataLayer worden niet automatisch gelezen. Koppel de grant vanuit je CMP.

## Cookies

First-party, host-only, `Path=/`, `SameSite=Lax`, `Secure` op HTTPS. JavaScript-writable, dus alleen opaque IDs:

| Cookie    | Inhoud                   |
| --------- | ------------------------ |
| `_lg_vid` | random visitor UUID      |
| `_lg_sid` | random session UUID      |
| `_lg_tok` | opaque attribution token |

Geen GCLID, e-mail of organization-id. Geen third-party cookies. Geen automatische `.example.nl` root-domain cookie. Geen localStorage voor click IDs.

Session timeout default 30 minuten (server mag `sessionTimeoutMinutes` teruggeven). Attribution window default 90 dagen.

## Click IDs

De SDK leest `gclid`, `gbraid` en `wbraid` met `URLSearchParams`. Alle aanwezige waarden gaan mee. Max 512 printable ASCII. Geen lowercase/truncate.

## Lead APIs

```js
LeadGuard.trackLead({
  eventId: crypto.randomUUID(),
  externalLeadId: "lead_123",
});
LeadGuard.getAttributionToken();
LeadGuard.attachAttributionToken("#offerte-formulier");
```

`attachAttributionToken` voegt alleen op het gekozen formulier een hidden `leadguard_attribution_token` toe. Nooit een `gclid` hidden field. Niet automatisch op ieder formulier.

Aanbevolen productiepad:

```text
form success
↓
backend persist
↓
POST /api/tracking/v1/leads
Authorization: Bearer lgsrv_...
{ eventId, attributionToken, externalLeadId? }
```

## CSP

Klanten moeten de LeadGuard-app-origin toestaan:

```text
script-src  https://<APP_URL>
connect-src https://<APP_URL>
```

Geen `eval` / `new Function`. Subresource Integrity is optioneel; de versioned URL is immutable-cacheable.

## Next.js (voorbeeld)

```tsx
import Script from "next/script";

<Script
  src="https://app.example/tracker/v1.js"
  strategy="afterInteractive"
  data-site-key="lg_site_..."
/>;
```

Na CMP-grant: `window.LeadGuard?.setConsent({ attribution: "granted" })`. Na succesvolle lead: `window.LeadGuard?.trackLead({ eventId })`.

## GTM / WordPress

De SDK mag via GTM of een WordPress custom HTML-block geladen worden. Consent moet alsnog via `setConsent` lopen. Er is geen WordPress-plugin in Fase 13.

## Server voorbeelden

Node:

```http
POST /api/tracking/v1/leads
Authorization: Bearer lgsrv_...
Content-Type: application/json

{"eventId":"UUID","attributionToken":"lgat_...","externalLeadId":"crm-1"}
```

PHP/`curl` zijn hetzelfde HTTP-contract. Geen taal-SDK's.

## Testen

`?leadguard_debug=1` logt `[LeadGuard] initialized` naar de console. Geen publiek debug-endpoint. De UI toont last event / last attribution / last lead.

Synthetische LeadGuard Browser/Form monitors no-oppen de SDK. Een `trackLead` maakt een capture-`Lead` met outcome `NEW`; won/lost/revenue is een latere, handmatige stap. Zie [Lead & revenue data layer](LEAD_REVENUE_DATA_LAYER.md).

## Beperkingen

- Geen cross-device of cross-domain linker (`example.nl` → `forms.partner.com` vereist expliciete token-doorgifte)
- Geen fingerprint-fallback als cookies ontbreken
- Attribution kan verloren gaan zonder consent
- SDK-fout mag de klantsite niet breken; de lead kan dan unattributed zijn
