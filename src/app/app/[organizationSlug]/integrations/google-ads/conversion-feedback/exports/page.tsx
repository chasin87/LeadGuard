import Link from "next/link";
import { formatMoney } from "@/lib/money";
import {
  identifierLabel,
  statusCopy,
} from "@/components/google-ads-conversion-card";
import { requireUser } from "@/server/authorization/session";
import { listConversionExports } from "@/server/google-ads/conversion-queries";
import { RetryConversionExportButton } from "@/components/conversion-export-buttons";

export const metadata = { title: "Conversion exports" };

function formatWhen(value: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

export default async function ConversionExportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationSlug: string }>;
  searchParams: Promise<{
    status?: string;
    website?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const { organizationSlug } = await params;
  const filters = await searchParams;
  const user = await requireUser();
  const { rows, canManage } = await listConversionExports(
    user.id,
    organizationSlug,
    {
      status: filters.status,
      websiteId: filters.website,
      from: filters.from,
      to: filters.to,
    },
  );

  return (
    <div className="px-5 py-10 lg:px-10">
      <p className="text-sm">
        <Link
          className="font-semibold text-[#19d0a2] hover:underline"
          href={`/app/${organizationSlug}/integrations/google-ads/conversion-feedback`}
        >
          Conversion feedback
        </Link>
      </p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">Exports</h1>
      <form className="mt-6 flex flex-wrap gap-3 text-sm" method="get">
        <label>
          Status
          <select
            className="ml-2 rounded-lg border border-[var(--border)] px-2 py-1"
            defaultValue={filters.status ?? ""}
            name="status"
          >
            <option value="">All</option>
            {Object.keys(statusCopy).map((status) => (
              <option key={status} value={status}>
                {statusCopy[status]}
              </option>
            ))}
          </select>
        </label>
        <label>
          From
          <input
            className="ml-2 rounded-lg border border-[var(--border)] px-2 py-1"
            defaultValue={filters.from ?? ""}
            name="from"
            type="date"
          />
        </label>
        <label>
          To
          <input
            className="ml-2 rounded-lg border border-[var(--border)] px-2 py-1"
            defaultValue={filters.to ?? ""}
            name="to"
            type="date"
          />
        </label>
        <button
          className="rounded-lg border border-[var(--border)] px-3 py-1 font-semibold"
          type="submit"
        >
          Filter
        </button>
      </form>
      <div className="mt-6 overflow-x-auto rounded-2xl border border-[var(--border)] bg-white">
        <table className="min-w-full text-left text-sm">
          <thead>
            <tr className="text-[var(--muted)]">
              <th className="px-4 py-3 font-semibold">Lead</th>
              <th className="px-4 py-3 font-semibold">Website</th>
              <th className="px-4 py-3 font-semibold">Won at</th>
              <th className="px-4 py-3 font-semibold">Value</th>
              <th className="px-4 py-3 font-semibold">Signal</th>
              <th className="px-4 py-3 font-semibold">Conversion action</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Last update</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr className="border-t border-[var(--border)]" key={row.id}>
                <td className="px-4 py-3">
                  <Link
                    className="font-semibold text-[#19d0a2] hover:underline"
                    href={`/app/${organizationSlug}/attribution/${row.lead.id}`}
                  >
                    {row.lead.publicLeadId}
                  </Link>
                </td>
                <td className="px-4 py-3">{row.website.name}</td>
                <td className="px-4 py-3">
                  {formatWhen(row.conversionTimestamp)}
                </td>
                <td className="px-4 py-3">
                  {row.valueAmountMinor !== null && row.currencyCode
                    ? formatMoney(row.valueAmountMinor, row.currencyCode)
                    : "—"}
                </td>
                <td className="px-4 py-3">
                  {identifierLabel(row.identifierTypes)}
                </td>
                <td className="px-4 py-3">
                  {row.config.conversionActionNameSnapshot}
                </td>
                <td className="px-4 py-3">
                  {statusCopy[row.status] ?? row.status}
                  {canManage &&
                  (row.status === "RETRYABLE_ERROR" ||
                    row.status === "NEEDS_REVIEW") ? (
                    <RetryConversionExportButton
                      organizationSlug={organizationSlug}
                      exportId={row.id}
                      compact
                    />
                  ) : null}
                </td>
                <td className="px-4 py-3">{formatWhen(row.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
