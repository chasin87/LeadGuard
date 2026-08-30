# Architectuur

## Fase 1

LeadGuard gebruikt Next.js App Router voor de webapplicatie en API, PostgreSQL als datastore en Prisma als type-safe databaseclient. De build gebruikt `output: standalone`, zodat deployment op een gewone Linux-server achter bijvoorbeeld Cloudflare geen Vercel-runtime vereist.

De huidige database-laag voert alleen een echte connectiviteitscontrole uit. Het domeinschema wordt bewust pas in fase 2 ingevoerd, tegelijk met de autorisatie- en multi-tenancyregels die het schema moeten afdwingen.

## Procesgrenzen

De beoogde runtime bestaat uit vier afzonderlijk te starten rollen:

1. **Web application** — dashboard, authenticatie, instellingen en API.
2. **Monitoring worker** — voert checks uit buiten webrequests.
3. **Scheduler** — plant verschuldigde checks in de PostgreSQL-backed queue.
4. **Notification worker** — verwerkt meldingen onafhankelijk en idempotent.

De directories `src/workers` en `src/jobs` reserveren deze grenzen zonder in fase 1 een schijnimplementatie toe te voegen. Een PostgreSQL-backed queue wordt gekozen wanneer de jobcontracten in fase 4 concreet zijn; daarmee voorkomen we nu een ongebruikte infrastructuurafhankelijkheid.

## Modulair ontwerp

Featurecode komt in `src/features/<feature>`. UI blijft dun; validatie, services en domeinregels leven binnen de feature of serverlaag. Integraties krijgen adapters onder `src/integrations`. Gedeelde infrastructuur hoort in `src/server`, terwijl universele utilities in `src/lib` staan.

## Deployment

Web, workers en scheduler zullen uit dezelfde versie van de codebase worden gebouwd maar als onafhankelijke processen draaien. PostgreSQL is de gedeelde duurzame infrastructuur. Horizontale schaal vereist later job locking, idempotentie en expliciete concurrency-limieten.
