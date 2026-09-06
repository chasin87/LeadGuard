export function PlatformBadge({
  tone,
  children,
}: {
  tone: "neutral" | "ok" | "warn" | "danger";
  children: React.ReactNode;
}) {
  const className =
    tone === "ok"
      ? "bg-[var(--brand-light)] text-[#193f36]"
      : tone === "warn"
        ? "bg-amber-50 text-amber-900"
        : tone === "danger"
          ? "bg-red-50 text-red-800"
          : "bg-slate-100 text-slate-800";
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${className}`}
    >
      {children}
    </span>
  );
}

export function accountTone(
  status: string,
): "neutral" | "ok" | "warn" | "danger" {
  if (status === "ACTIVE") return "ok";
  if (status === "OVER_LIMIT" || status === "TRIAL_EXPIRED") return "warn";
  if (status === "SUSPENDED") return "danger";
  return "neutral";
}
