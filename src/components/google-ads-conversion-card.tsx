import { formatMoney } from "@/lib/money";
import { safeDiagnosticCopy } from "@/server/google-data-manager/diagnostics";
import {
  QueueLeadConversionButton,
  RetryConversionExportButton,
} from "@/components/conversion-export-buttons";

const statusCopy: Record<string, string> = {
  PENDING: "Queued",
  BLOCKED: "Blocked",
  READY: "Queued",
  SUBMITTING: "Submitting",
  PROCESSING: "Processing at Google",
  SUCCEEDED: "Succeeded",
  REJECTED: "Rejected",
  RETRYABLE_ERROR: "Retrying",
  NEEDS_REVIEW: "Needs review",
  CANCELLED: "Cancelled",
  OUT_OF_SYNC: "Out of sync",
};

function identifierLabel(types: string) {
  return types
    .split(",")
    .filter(Boolean)
    .map((item) => `${item} captured`)
    .join(", ");
}

function formatWhen(value: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

export function GoogleAdsConversionCard({
  organizationSlug,
  leadId,
  canManage,
  exportRow,
}: {
  organizationSlug: string;
  leadId: string;
  canManage: boolean;
  exportRow: {
    id: string;
    status: string;
    conversionTimestamp: Date;
    valueAmountMinor: bigint | null;
    currencyCode: string | null;
    identifierTypes: string;
    lastErrorCode: string | null;
    outOfSyncReason: string | null;
    blockReason: string | null;
    config: { conversionActionNameSnapshot: string } | null;
  } | null;
}) {
  if (!exportRow) {
    if (!canManage) return null;
    return (
      <section className="mt-6 max-w-2xl rounded-2xl border border-[var(--border)] bg-white p-6">
        <h2 className="text-lg font-bold">Google Ads feedback</h2>
        <p className="mt-2 text-sm text-[var(--muted)]">
          No Google Ads conversion has been queued for this lead.
        </p>
        <div className="mt-4">
          <QueueLeadConversionButton
            organizationSlug={organizationSlug}
            leadId={leadId}
          />
        </div>
      </section>
    );
  }

  const diagnostic = safeDiagnosticCopy(exportRow.lastErrorCode);
  const retryable =
    exportRow.status === "RETRYABLE_ERROR" ||
    exportRow.status === "NEEDS_REVIEW";

  return (
    <section className="mt-6 max-w-2xl rounded-2xl border border-[var(--border)] bg-white p-6">
      <h2 className="text-lg font-bold">Google Ads feedback</h2>
      <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="font-semibold text-[var(--muted)]">Status</dt>
          <dd className="mt-1" data-testid="google-conversion-status">
            {statusCopy[exportRow.status] ?? exportRow.status}
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-[var(--muted)]">
            Conversion action
          </dt>
          <dd className="mt-1">
            {exportRow.config?.conversionActionNameSnapshot ?? "—"}
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-[var(--muted)]">Conversion time</dt>
          <dd className="mt-1">{formatWhen(exportRow.conversionTimestamp)}</dd>
        </div>
        <div>
          <dt className="font-semibold text-[var(--muted)]">Value sent</dt>
          <dd className="mt-1" data-testid="google-conversion-value">
            {exportRow.valueAmountMinor !== null && exportRow.currencyCode
              ? formatMoney(exportRow.valueAmountMinor, exportRow.currencyCode)
              : "No value"}
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-[var(--muted)]">Identifier</dt>
          <dd className="mt-1">{identifierLabel(exportRow.identifierTypes)}</dd>
        </div>
        <div>
          <dt className="font-semibold text-[var(--muted)]">Google request</dt>
          <dd className="mt-1">
            {exportRow.status === "SUCCEEDED"
              ? "Processed"
              : exportRow.status === "PROCESSING"
                ? "Processing"
                : (statusCopy[exportRow.status] ?? exportRow.status)}
          </dd>
        </div>
      </dl>
      {exportRow.status === "REJECTED" ||
      exportRow.status === "NEEDS_REVIEW" ? (
        <div className="mt-4 rounded-xl bg-amber-50 p-4 text-sm">
          <p className="font-semibold">{diagnostic.title}</p>
          <p className="mt-1">{diagnostic.detail}</p>
          <p className="mt-1 text-[var(--muted)]">{diagnostic.action}</p>
        </div>
      ) : null}
      {exportRow.status === "OUT_OF_SYNC" ? (
        <p className="mt-4 text-sm text-amber-900">
          Lead outcome changed after Google export. Automatic correction is not
          available for this export method.
        </p>
      ) : null}
      {canManage && retryable ? (
        <RetryConversionExportButton
          organizationSlug={organizationSlug}
          exportId={exportRow.id}
        />
      ) : null}
    </section>
  );
}

export { statusCopy, identifierLabel };
