export default function IncidentNotFound() {
  return (
    <div className="px-5 py-10 lg:px-10">
      <h1 className="text-3xl font-bold tracking-tight">Incident not found</h1>
      <p className="mt-3 max-w-xl text-[var(--muted)]">
        This incident does not exist in this organization.
      </p>
    </div>
  );
}
