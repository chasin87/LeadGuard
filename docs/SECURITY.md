# Security-baseline

## In fase 1 aanwezig

- Serverconfiguratie wordt met Zod gevalideerd en secrets staan uitsluitend in genegeerde `.env`-bestanden of de runtime environment.
- `.env.example` bevat alleen placeholders.
- De logging abstraction schrijft gestructureerde records en redigeert bekende gevoelige contextvelden.
- De health endpoint geeft geen exceptiondetails, credentials of infrastructuurgegevens terug.
- Next.js' `poweredByHeader` is uitgeschakeld.
- TypeScript strict mode en `noUncheckedIndexedAccess` zijn actief.

## Grenzen van deze fase

Er worden nog geen user-controlled monitor-URL's opgehaald. SSRF-bescherming hoort daarom bij fase 3, vóórdat enige URL kan worden opgeslagen of gevolgd. Die module moet protocolrestricties, hostname- en IP-classificatie, DNS-resolutie en hercontrole van iedere redirect afdwingen. Private, loopback, link-local, multicast en gereserveerde IPv4/IPv6-ranges moeten standaard worden geweigerd.

Authenticatie, sessiebeveiliging, CSRF-overwegingen, organization-scoped autorisatie en rate limiting worden met de eerste beveiligde mutaties in fase 2 toegevoegd. Tot die tijd zijn dashboard en login alleen niet-gevoelige previews.

## Secretbeheer

Commit nooit `.env` of productiecredentials. Injecteer secrets op de server via een afgeschermde environment/configuratie. Log geen requestheaders, cookies, tokens, database-URL's of volledige foutobjecten zonder expliciete sanitization.

## Meldingen

Meld kwetsbaarheden privé aan het projectteam. Voeg geen exploits of credentials aan publieke issues toe.
