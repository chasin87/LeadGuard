export default function LeadNotFound() {
  return (
    <div className="px-5 py-10 lg:px-10">
      <h1 className="text-3xl font-bold">Lead not found</h1>
      <p className="mt-2 text-[var(--muted)]">
        This lead does not exist in this organization.
      </p>
    </div>
  );
}
