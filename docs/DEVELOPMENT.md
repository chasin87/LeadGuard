# Development

## PostgreSQL zonder Docker

Installeer PostgreSQL 16 of nieuwer via het packagebeheer van je besturingssysteem of gebruik een beheerde developmentdatabase. Maak vervolgens een lokale rol en database aan, bijvoorbeeld in `psql`:

```sql
CREATE ROLE leadguard WITH LOGIN PASSWORD 'kies-een-lokaal-wachtwoord';
CREATE DATABASE leadguard OWNER leadguard;
```

Kopieer `.env.example` naar `.env` en vervang de placeholder in `DATABASE_URL`. Het repository bevat op verzoek geen Docker- of Docker Compose-configuratie.

## Installatie

```bash
npm install
npm run db:generate
npm run db:validate
npx prisma migrate deploy
npm run db:check
```

De migratie maakt User, Organization, OrganizationMember en OrganizationRole reproduceerbaar aan. `db:check` doet een echte `SELECT 1` en faalt als PostgreSQL niet bereikbaar is.

## Dagelijkse workflow

Start de webapp met `npm run dev`. Voer vóór een commit ten minste formatter, lint, typecheck, unit tests en build uit. Playwright start zelf een developmentserver; installeer de Chromium-binary eenmalig met `npx playwright install chromium`.

## Environment

| Variabele | Vereist | Omschrijving |
| --- | --- | --- |
| `DATABASE_URL` | Ja | PostgreSQL connection string; alleen server-side |
| `APP_URL` | Nee | Publieke applicatie-origin, standaard lokaal |
| `AUTH_SECRET` | Ja | Minimaal 32 willekeurige tekens voor Auth.js |
| `AUTH_TRUST_HOST` | Nee | Vertrouw de reverse-proxy host; standaard `true` |
| `LOG_LEVEL` | Nee | `debug`, `info`, `warn` of `error` |

Genereer een secret met `openssl rand -base64 32`. Wijzig `.env.example` wanneer een nieuwe verplichte variabele wordt toegevoegd, zonder echte waarden op te nemen.

## Tests

Unit tests controleren inputvalidatie, slugcollisions, role permissions, laatste-OWNER-bescherming en tenantisolatie. Playwright gebruikt een echte developmentdatabase en maakt unieke `example.test`-accounts voor de volledige registratie/login/logout-flow en cross-tenant routeproef. Gebruik hiervoor nooit een productiedatabase.
