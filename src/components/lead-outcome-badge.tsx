import type { LeadOutcomeStatus } from "@/generated/prisma/enums";

const styles: Record<LeadOutcomeStatus, string> = {
  NEW: "bg-slate-100 text-slate-800",
  QUALIFIED: "bg-sky-50 text-sky-800",
  WON: "bg-emerald-50 text-emerald-800",
  LOST: "bg-red-50 text-red-800",
};

const labels: Record<LeadOutcomeStatus, string> = {
  NEW: "New",
  QUALIFIED: "Qualified",
  WON: "Won",
  LOST: "Lost",
};

export function LeadOutcomeBadge({ status }: { status: LeadOutcomeStatus }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${styles[status]}`}
    >
      {labels[status]}
    </span>
  );
}
