# LeadGuard

LeadGuard wordt een multi-tenant SaaS-platform dat bedrijven beschermt tegen verspild advertentiebudget en gemiste leads. De repository bevat nu de projectfoundation en **fase 2: authentication en multi-tenancy**. Website- en monitoringfunctionaliteit is nog niet gebouwd.

## Vereisten

- Node.js 22 of nieuwer
- npm 10 of nieuwer
- Een lokaal of extern PostgreSQL 16+-instance (Docker is niet nodig)

## Lokaal starten

```bash
npm install
cp .env.example .env
# Pas DATABASE_URL in .env aan voor je eigen PostgreSQL-installatie.
npm run db:generate
npm run db:validate
npx prisma migrate deploy
npm run db:check
npm run dev
```

Open daarna <http://localhost:3000>. `GET /api/health` retourneert HTTP 200 als de applicatie de database kan bereiken en HTTP 503 als dat niet lukt.

## Kwaliteitscontroles

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

## Projectindeling

- `src/app` — Next.js App Router, pagina's en API-routes
- `src/components` — gedeelde presentational components
- `src/features` — auth- en organization-domeinregels en validatie
- `src/server` — server-only infrastructuur, database en logging
- `src/workers` — toekomstige onafhankelijk uitvoerbare workers
- `src/jobs` — toekomstige queue- en jobcontracten
- `src/integrations` — toekomstige externe providers
- `prisma` — Prisma-schema
- `tests/e2e` — Playwright end-to-end tests
- `docs` — architectuur-, security- en ontwikkeldocumentatie

Zie [Development](docs/DEVELOPMENT.md) voor PostgreSQL-instructies zonder Docker en [Architecture](docs/ARCHITECTURE.md) voor de vastgelegde grenzen.

## Authentication en organisaties

Registratie maakt in één transactie een gebruiker, organisatie en OWNER-membership. Auth.js beheert een versleutelde, HttpOnly JWT-sessie; wachtwoorden worden uitsluitend als Argon2id-hash opgeslagen. Iedere tenantroute gebruikt `/app/[organizationSlug]/...` en controleert server-side de combinatie van sessiegebruiker, organisatie en membership.

Beschikbare routes zijn `/register`, `/login`, `/onboarding`, `/app/[organizationSlug]/dashboard`, `/app/[organizationSlug]/settings` en `/app/[organizationSlug]/settings/members`. Het dashboard toont uitsluitend een lege productstate.
