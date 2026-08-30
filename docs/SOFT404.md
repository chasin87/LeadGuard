# Soft-404 detection

LeadGuard behandelt HTTP 200 niet automatisch als een gezonde pagina. Een landingspagina kan technisch succesvol antwoorden en inhoudelijk alsnog een foutpagina zijn:

```text
HTTP 200
+
"Page not found" / "Pagina niet gevonden"
↓
FAILURE
SOFT_404
```

Dat is relevant voor advertenties: de URL is bereikbaar, maar de bezoeker landt op een commercieel waardeloze not-found-pagina.

## Wat het niet is

Een echte HTTP 404 blijft `HTTP_404`. Soft-404-analyse draait alleen na een technisch succesvolle response (`200–299`), inclusief na redirects die op 200 eindigen.

JSON, PDF, images en andere binaire types worden overgeslagen. Soft-404 is gericht op webpagina's, niet op API-monitoring.

## Pipeline

```text
1. transport/network
2. HTTP status
3. redirects (bestaande SSRF + pinned IP)
4. succesvolle response + geschikt content-type?
5. soft-404 analyse
6. performance degradation (trage 2xx)
7. eindresultaat MonitorCheck
```

Precedence:

```text
transport failure
  > HTTP status failure (404/5xx/…)
  > soft-404 FAILURE
  > latency DEGRADED
  > SUCCESS
```

Een trage 200 met een duidelijke foutpagina is dus `SOFT_404`, niet `DEGRADED`. Een HTTP 500 met HTML "Page not found" blijft `HTTP_5XX`.

## Content-types

Geanalyseerd:

- `text/html`
- `application/xhtml+xml`
- `text/plain`
- ontbrekend content-type, alleen als de body op HTML lijkt (`<!doctype html`, `<html`, …)

Niet geanalyseerd: `image/*`, `video/*`, `application/pdf`, `application/json`, `application/zip`, fonts, overige binary.

## Body-limiet

De HTTP-client leest maximaal **128 KiB** (`SOFT404_MAX_BODY_BYTES`). Daarna wordt de stream gestopt. Gzip/brotli/deflate worden gedecomprimeerd tot dezelfde cap (`maxOutputLength`) tegen decompression bombs.

De HTML wordt **niet** in `MonitorCheck` opgeslagen. Alleen:

- `soft404Score` (0–100)
- `soft404ClassifierVersion` (`v1`)
- `soft404Signals` (vaste codes, geen paginafragmenten)

## Heuristiek v1

Geen `body.includes("404")`. De classifier combineert gewogen signalen:

| Signaal | Gewicht | Code |
| ------- | ------: | ---- |

    | Title bevat sterke not-found phrase | 50 | `TITLE_NOT_FOUND` |
    | H1 bevat sterke not-found phrase | 50 | `H1_NOT_FOUND` |

| H2 bevat sterke not-found phrase | 20 | `H2_NOT_FOUND` |
| Body bevat sterke not-found phrase | 25 | `BODY_NOT_FOUND_PHRASE` |
| Title is in wezen "404" | 10 | `TITLE_404` |
| H1 is in wezen "404" | 15 | `H1_404` |
| Weinig zichtbare content + sterke phrase | 30 | `LOW_CONTENT` |
| `noindex` + sterke phrase | 5 | `NOINDEX` |
| Canonical naar homepage + sterke phrase | 5 | `CANONICAL_HOME` |
| Generieke template-phrase + andere signalen | 8 | `TEMPLATE_ERROR` |

Talen: Engels en Nederlands, plus enkele generieke varianten. Tekst wordt genormaliseerd (whitespace, casing, HTML entities).

Drempels:

- `score >= 80` én minstens één sterke phrase → `SOFT_404` → check `FAILURE`
- `50–79` → intern `POSSIBLE_SOFT_404`, **geen** failure (geen DEGRADED-ruis)
- `< 50` → normale HTTP-classificatie

Korte foutpagina's scoren hoger dan lange artikelen met een incidentele phrase. Alleen weinig content is nooit een fout.

## False-positive bescherming

- Het getal `404` alleen is nooit voldoende (`Model 404`, `€404`, `Artikel 404`).
- Productachtige titels (`Product 404 Pro`) krijgen geen 404-nummerscore.
- Artikelen over HTTP 404 / statuscodes worden afgetopt.
- Lange pagina's zonder title/H1-foutphrase worden afgetopt.
- `noindex` of canonical-mismatch alleen opent nooit een incident.
- Footer-links zoals "404 page" op een normale marketingpagina falen niet.

## Redirects

Redirect naar een generieke 200-foutpagina (`/old-ad` → `/not-found` → 200) kan `SOFT_404` zijn. `requestedUrl`, `finalUrl` en `redirectCount` blijven de bestaande velden.

Redirect naar de **homepage** (`/old-campaign` → `/` → 200 homepage) is in deze fase **geen** soft-404. Dat is mogelijk landing-page drift en hoort bij een latere feature.

## Bekende beperkingen

- Alleen de HTTP-response-HTML. Client-side gerenderde app shells (`<div id="root"></div>`) die pas in de browser een 404 tonen, vallen onder Browser Monitoring: dezelfde classifier draait op zichtbare gerenderde tekst. Zie [Browser monitoring](BROWSER_MONITORING.md).
- Geen automatische baseline van de site-eigen 404-template (`/random-known-nonexistent-path`). Extra requests, side-effects en rate limits maken dat ongeschikt voor MVP.
- Geen SimHash, MinHash, DOM-fingerprinting of AI/LLM-classificatie.
- Geen screenshots, geen JS-uitvoering, geen custom phrase-editor voor gebruikers.
- Classifier-interface is voorbereid (`HeuristicSoft404Classifier`); alleen heuristics zijn geïmplementeerd.

## Incidents en alerts

`SOFT_404` is een gewone `FAILURE`. De Incident Engine telt consecutive failures, opent/resolvet incidents en schrijft outbox-events. Bestaande e-mail/webhook-templates tonen een begrijpelijke problemregel, geen `UNKNOWN`.

HTTP-monitors hebben geen user-toggle: soft-404 staat altijd aan. Ongeschikte content-types slaan de analyzer vanzelf over.

## Debugging

Monitor detail toont bij een soft-404: HTTP 200, reason, confidence (bijv. High confidence 92%) en signal-labels. Ruwe HTML wordt niet getoond.
