# LeadGuard

LeadGuard wordt een multi-tenant SaaS-platform dat bedrijven beschermt tegen verspild advertentiebudget en gemiste leads. Deze repository bevat uitsluitend **fase 1: de production-oriented projectfoundation**. Er is nog geen authenticatie, klantdata of monitoringengine.

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
- `src/features` — toekomstige featuremodules met eigen domeinlogica
- `src/server` — server-only infrastructuur, database en logging
- `src/workers` — toekomstige onafhankelijk uitvoerbare workers
- `src/jobs` — toekomstige queue- en jobcontracten
- `src/integrations` — toekomstige externe providers
- `prisma` — Prisma-schema
- `tests/e2e` — Playwright end-to-end tests
- `docs` — architectuur-, security- en ontwikkeldocumentatie

Zie [Development](docs/DEVELOPMENT.md) voor PostgreSQL-instructies zonder Docker en [Architecture](docs/ARCHITECTURE.md) voor de vastgelegde grenzen.

## Huidige scope

De login en het dashboard zijn expliciete foundation-previews. Ze simuleren geen sessie of monitoringdata. Auth.js, het multi-tenant datamodel en autorisatie behoren tot fase 2 en worden pas na een expliciete vervolgopdracht gebouwd.
