export default function OrganizationNotFound() {
  return (
    <main className="grid min-h-screen place-items-center px-5">
      <section>
        <h1 className="text-2xl font-bold">Organisatie niet gevonden</h1>
        <p className="mt-2 text-[var(--muted)]">
          Deze organisatie bestaat niet of is niet beschikbaar.
        </p>
      </section>
    </main>
  );
}
