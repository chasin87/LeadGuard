import type { WebsiteDnsStatus, WebsiteStatus } from "@/generated/prisma/enums";

export function WebsiteStatusBadge({ status }: { status: WebsiteStatus }) {
  const label = status === "ACTIVE" ? "Active" : "Disabled";
  const className =
    status === "ACTIVE"
      ? "bg-slate-100 text-slate-800"
      : "bg-amber-50 text-amber-900";

  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${className}`}
    >
      {label}
    </span>
  );
}

export function WebsiteDnsNote({ status }: { status: WebsiteDnsStatus }) {
  if (status !== "UNRESOLVED") return null;
  return (
    <p className="text-sm text-[var(--muted)]">
      Hostname could not be verified yet. LeadGuard will check DNS again before
      any future monitoring request.
    </p>
  );
}
