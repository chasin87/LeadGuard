# Architectuur

## Foundation en fase 2

LeadGuard gebruikt Next.js App Router voor de webapplicatie en API, PostgreSQL als datastore en Prisma als type-safe databaseclient. De build gebruikt `output: standalone`, zodat deployment op een gewone Linux-server achter bijvoorbeeld Cloudflare geen Vercel-runtime vereist.

Auth.js verzorgt credentials-authentication en versleutelde JWT-sessies. `src/server/auth` bevat credential- en passwordlogica; `src/server/authorization` is de centrale tenantgrens; `src/server/organizations` bevat transactionele workflows. React-componenten lezen nooit rechtstreeks een ongefilterde organization-tabel.

## Multi-tenancy

```text
User
  └── OrganizationMember (OWNER | ADMIN | MEMBER)
          └── Organization
```

User en Organization vormen een many-to-many-relatie via OrganizationMember. E-mail, slug en `(userId, organizationId)` zijn uniek. Alle toekomstige tenant-owned records krijgen een verplichte relatie met Organization.

De actieve organisatie staat in `/app/[organizationSlug]`. De slug bepaalt alleen routing: `requireOrganizationMembership` controleert daarnaast de ingelogde user-ID en bijbehorende membership. Mutaties gebruiken `requireOrganizationPermission`; OWNER, ADMIN en MEMBER worden centraal aan permissions gekoppeld.

Registratie creëert User, Organization en OWNER-membership atomair. Ook een extra organisatie en het bijbehorende OWNER-membership worden in één transactie gemaakt. Slugcollisions krijgen deterministische suffixen en database uniqueness blijft de laatste verdediging tegen races.

## Procesgrenzen

De beoogde runtime bestaat uit vier afzonderlijk te starten rollen:

1. **Web application** — dashboard, authenticatie, instellingen en API.
2. **Monitoring worker** — voert checks uit buiten webrequests.
3. **Scheduler** — plant verschuldigde checks in de PostgreSQL-backed queue.
4. **Notification worker** — verwerkt meldingen onafhankelijk en idempotent.

De directories `src/workers` en `src/jobs` reserveren deze grenzen zonder een schijnimplementatie toe te voegen. Een PostgreSQL-backed queue wordt gekozen wanneer de jobcontracten in fase 4 concreet zijn; daarmee voorkomen we nu een ongebruikte infrastructuurafhankelijkheid.

## Modulair ontwerp

Featurecode komt in `src/features/<feature>`. UI blijft dun; validatie, services en domeinregels leven binnen de feature of serverlaag. Integraties krijgen adapters onder `src/integrations`. Gedeelde infrastructuur hoort in `src/server`, terwijl universele utilities in `src/lib` staan.

## Deployment

Web, workers en scheduler zullen uit dezelfde versie van de codebase worden gebouwd maar als onafhankelijke processen draaien. PostgreSQL is de gedeelde duurzame infrastructuur. Horizontale schaal vereist later job locking, idempotentie en expliciete concurrency-limieten.
