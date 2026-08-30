# Security-baseline

## Aanwezige maatregelen

- Serverconfiguratie wordt met Zod gevalideerd en secrets staan uitsluitend in genegeerde `.env`-bestanden of de runtime environment.
- `.env.example` bevat alleen placeholders.
- De logging abstraction schrijft gestructureerde records en redigeert bekende gevoelige contextvelden.
- De health endpoint geeft geen exceptiondetails, credentials of infrastructuurgegevens terug.
- Next.js' `poweredByHeader` is uitgeschakeld.
- TypeScript strict mode en `noUncheckedIndexedAccess` zijn actief.
- Argon2id bewaart wachtwoorden met expliciete memory- en time-cost; hashes komen niet in sessies of clientresponses.
- Auth.js gebruikt versleutelde, HttpOnly cookies, `SameSite=Lax`, production-only `Secure` en een sessieverlooptijd van 30 dagen.
- Loginmeldingen onthullen niet of een e-mailadres bestaat.
- Tenanttoegang wordt server-side op `(userId, organizationSlug)` gecontroleerd. Een slug of organization-ID alleen verleent nooit toegang.
- Role permissions staan centraal; organization-updates vragen expliciet OWNER-permission.
- Ledenqueries beginnen pas na autorisatie en filteren op de geautoriseerde organization-ID.
- Open redirects worden niet geaccepteerd: redirects worden uitsluitend server-side uit bekende slugs samengesteld.
- De laatste-OWNER-regel is als centrale domeinregel aanwezig en moet voor iedere toekomstige role/delete-mutatie worden gebruikt.

## Grenzen van deze fase

Er worden nog geen user-controlled monitor-URL's opgehaald. SSRF-bescherming hoort daarom bij fase 3, vóórdat enige URL kan worden opgeslagen of gevolgd. Die module moet protocolrestricties, hostname- en IP-classificatie, DNS-resolutie en hercontrole van iedere redirect afdwingen. Private, loopback, link-local, multicast en gereserveerde IPv4/IPv6-ranges moeten standaard worden geweigerd.

Auth.js server actions en handlers leveren CSRF- en cookiebeveiliging. Rate limiting is nog een verplichte deploymentmaatregel: plaats login en registratie achter Cloudflare rate limiting of een gedeelde PostgreSQL-backed limiter voordat publieke productie-registratie wordt geopend. Een proceslokale limiter is bewust niet gebruikt omdat die horizontaal eenvoudig te omzeilen is.

Member role-wijziging en verwijdering hebben nog geen endpoint of UI. Wanneer die worden toegevoegd moeten ze autorisatie, de laatste-OWNER-regel en een transactionele databasecheck gebruiken. User deletion is om dezelfde reden nog niet geïmplementeerd.

## Secretbeheer

Commit nooit `.env` of productiecredentials. Injecteer secrets op de server via een afgeschermde environment/configuratie. Log geen requestheaders, cookies, tokens, database-URL's of volledige foutobjecten zonder expliciete sanitization.

## Meldingen

Meld kwetsbaarheden privé aan het projectteam. Voeg geen exploits of credentials aan publieke issues toe.
