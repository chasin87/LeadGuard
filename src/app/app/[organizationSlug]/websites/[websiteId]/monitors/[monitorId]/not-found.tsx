export default function MonitorNotFound() {
  return (
    <div className="px-5 py-10 lg:px-10">
      <h1 className="text-2xl font-bold">Monitor not found</h1>
      <p className="mt-2 text-[var(--muted)]">
        This monitor is not available in this organization.
      </p>
    </div>
  );
}
