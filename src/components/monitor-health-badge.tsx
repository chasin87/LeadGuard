import type { MonitorHealth } from "@/server/incidents/health";
import { healthLabel } from "@/lib/monitoring/display";

export function MonitorHealthBadge({ health }: { health: MonitorHealth }) {
  const styles = {
    operational: "bg-slate-100 text-slate-800",
    degraded: "bg-amber-50 text-amber-900",
    failing: "bg-red-50 text-red-800",
    down: "bg-red-100 text-red-900",
    pending: "bg-slate-50 text-slate-600",
    pending_confirmation: "bg-amber-50 text-amber-900",
  } as const;

  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${styles[health]}`}
    >
      {health === "pending"
        ? "Pending"
        : health === "pending_confirmation"
          ? "Waiting for receipt"
          : healthLabel(health)}
    </span>
  );
}
