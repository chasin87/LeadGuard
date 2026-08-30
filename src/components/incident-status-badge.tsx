export function IncidentStatusBadge({
  status,
}: {
  status: "OPEN" | "RESOLVED";
}) {
  const open = status === "OPEN";
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
        open ? "bg-red-50 text-red-800" : "bg-slate-100 text-slate-800"
      }`}
    >
      {open ? "Open" : "Resolved"}
    </span>
  );
}
