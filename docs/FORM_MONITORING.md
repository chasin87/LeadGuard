# Form monitoring

LeadGuard kan controleren of een bezoeker een leadformulier écht kan invullen en verzenden.

```text
HTTP Monitor:  is deze URL technisch bereikbaar?
Browser Monitor: kan een bezoeker de pagina zien?
Form Monitor:  kan een bezoeker dit formulier succesvol versturen?
```

Form Monitoring gebruikt dezelfde Playwright/Chromium-infrastructuur als Browser Monitoring. Er is geen tweede browserstack. Playwright draait nooit in een Next.js-request.

```text
Scheduler
   ↓
pg-boss
   ├── monitor.check          → HTTP Worker
   ├── monitor.browser.check  → Browser Worker
   └── monitor.form.check     → Browser Worker (FORM concurrency)
```

## Architectuur

FORM-jobs gaan naar `monitor.form.check` met group `form:{hostname}` (maximaal één actieve FORM-check per hostname). De Browser Worker verwerkt beide Chromium-queues. HTTP-monitoring blijft op een aparte queue en wordt niet geblokkeerd.

Concurrency default: `FORM_WORKER_CONCURRENCY=1`. Elke check krijgt een nieuwe `BrowserContext`. Na mogelijke submit is er **geen automatische tweede submit**.

## Configuratie

| Veld            | Opmerking                                |
| --------------- | ---------------------------------------- |
| Form selector   | CSS, bij voorkeur `form#id`              |
| Submit selector | zichtbaar én enabled vóór klik           |
| Field mappings  | role + control + CSS selector            |
| Success         | selector, URL en/of tekst; default `ANY` |
| Test profile    | organisatie-eigen naam/e-mail/telefoon   |
| Frequency       | default 6 uur, minimum 1 uur             |
| Status          | start `PAUSED` tot een echte test slaagt |

Geen custom JavaScript, geen file upload, geen login, geen payment, geen multi-step builder.

## Activation flow

```text
Create (PAUSED, UNVERIFIED, consent)
↓
Validate configuration (geen submit)
↓
Send real test lead (één submit)
↓
SUCCESS → VERIFIED (receipt mode NONE)
of
SUCCESS + receipt RECEIVED → VERIFIED + receiptVerifiedAt
↓
Enable scheduled tests (ACTIVE)
```

OWNER/ADMIN bevestigt bij aanmaken:

- het formulier is veilig voor testleads;
- LeadGuard mag echte submissions doen;
- testleads kunnen in CRM/e-mail verschijnen.

Consent (`consentedAt`, `consentedByUserId`, `consentVersion`) is auditbaar.

MEMBER is read-only.

## Testdata

LeadGuard vult herkenbare testdata in, inclusief unieke `submissionId` (`LG-YYYYMMDD-` + 12 random tekens) in het bericht, optioneel in een hidden field `LEADGUARD_SUBMISSION_ID`, en bij inbound-email mode als plus-tag op het receipt-adres. Formulierwaarden worden niet opgeslagen in MonitorCheck.

## Success

Default `successMode = ANY`: één geconfigureerd signaal is genoeg.

- selector: zichtbaar na submit
- URL: veilige pathname/prefix/glob (`*`), geen vrije regex
- tekst: zichtbare gerenderde tekst, genormaliseerd

## CAPTCHA

LeadGuard omzeilt CAPTCHA niet. Detectie van reCAPTCHA, hCaptcha of Turnstile → `UNSUPPORTED_CAPTCHA`. Geen incident. UI: automated submission cannot be tested.

## Retry & dubbele leads

```text
PREPARED → (vóór klik) SUBMITTING persist → click → CONFIRMED | FAILED | AMBIGUOUS
```

Infrastructure retry vóór submit is toegestaan. Na `SUBMITTING` herbiedt de worker dezelfde job **niet** opnieuw. Resultaat: `AMBIGUOUS_SUBMISSION`. Handmatig hertesten kan een tweede testlead maken.

## Classificatie (hoogste eerst)

```text
unsafe request
> navigation/crash
> invalid configuration (geen incident)
> captcha / unsupported form type (geen incident)
> HTTP 4xx/5xx hoofddocument
> form/field/submit missing
> unmapped required field
> not interactable / option missing / submit disabled
> form validation error
> submit API 5xx
> success not confirmed / timeout / unexpected navigation / ambiguous
> success
```

Runtime failures (formulier verdwenen, API 500, geen success) tellen voor de Incident Engine. Configuratiefouten, CAPTCHA en payment/password-forms niet.

`FORM_VALIDATION_ERROR` is in deze fase een FAILURE (testdata/mapping voldoet niet meer). UI maakt duidelijk dat dit geen klassieke outage is.

## Privacy

- geen request/response bodies
- geen testdata in logs of notificaties
- failure-screenshots in private artifact storage
- tracking/conversion-endpoints blijven geblokkeerd (geen 100% garantie tegen client-side conversion)
- inbound receipt-mail: geen body, HTML of attachments bewaren

## Security

Zelfde browser network policy als Fase 8. Form `action` naar localhost/metadata/private IP wordt geblokkeerd (`UNSAFE_BROWSER_REQUEST`). Website-boundary, consent, lage frequentie, één submit per check, per-host lock.

Receipt-callbacks zijn publiek maar authenticated (Bearer of HMAC), rate-limited, idempotent en tenant-scoped. Zie [Lead receipt verification](LEAD_RECEIPT_VERIFICATION.md).

## Known limitations

- native CRM-connectors zitten in een latere fase; webhook is de generieke brug
- CAPTCHA blokkeert automatisering
- geen multi-step forms
- geen file upload
- geen authenticated forms
- geen payment flows
- cookie banner: optionele enkele accept-selector, geen popup-builder
- 100% voorkomen van analytics/conversion is niet gegarandeerd
- inbound email vereist een externe mailprovider en een workflow die naar het testadres kan mailen
- Google Ads destination health is een apart `AD_DESTINATION`-type, geen FORM-check
