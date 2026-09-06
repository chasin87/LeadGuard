import Link from "next/link";
import { notFound } from "next/navigation";
import { hasOrganizationPermission } from "@/server/authorization/permissions";
import { loadOrganizationAccess } from "@/server/authorization/organization";
import { requireUser } from "@/server/authorization/session";
import { getOutcomeIntegrationDetail } from "@/server/outcomes/queries";
import { OutcomeIntegrationSecretPanel } from "@/components/outcome-integration-secret-panel";
import { formatRelativeTime } from "@/lib/monitoring/display";

export const metadata = { title: "Outcome integration" };

export default async function OutcomeIntegrationDetailPage({
  params,
}: {
  params: Promise<{ organizationSlug: string; integrationId: string }>;
}) {
  const { organizationSlug, integrationId } = await params;
  const user = await requireUser();
  const access = await loadOrganizationAccess(user.id, organizationSlug);
  if (access.status !== "ok") return null;
  const detail = await getOutcomeIntegrationDetail(
    access.context.organization.id,
    integrationId,
  );
  if (!detail) notFound();
  const canManage = hasOrganizationPermission(
    access.context.membership.role,
    "integrations:manage",
  );
  const count = (status: string) => detail.counts[status] ?? 0;

  return (
    <div className="px-5 py-10 lg:px-10">
      <p className="text-sm">
        <Link
          className="font-semibold text-[#19d0a2] hover:underline"
          href={`/app/${organizationSlug}/integrations/outcomes`}
        >
          Outcome ingestion
        </Link>
      </p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">{detail.name}</h1>
      <p className="mt-2 text-[var(--muted)]">
        {detail.type} · {detail.authMode} · {detail.sourceSystem} ·{" "}
        {detail.status}
      </p>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Last event{" "}
        {detail.lastEventReceivedAt
          ? formatRelativeTime(detail.lastEventReceivedAt)
          : "never"}
      </p>

      <dl className="mt-6 grid max-w-3xl gap-3 text-sm sm:grid-cols-4">
        {[
          "RECEIVED",
          "APPLIED",
          "DUPLICATE",
          "UNMATCHED",
          "STALE",
          "CONFLICT",
          "REJECTED",
        ].map((status) => (
          <div
            key={status}
            className="rounded-xl border border-[var(--border)] bg-white p-3"
          >
            <dt className="font-semibold text-[var(--muted)]">{status}</dt>
            <dd className="mt-1 text-lg font-bold">{count(status)}</dd>
          </div>
        ))}
      </dl>

      <section className="mt-8 max-w-3xl rounded-2xl border border-[var(--border)] bg-white p-6">
        <h2 className="text-lg font-bold">API</h2>
        <p className="mt-2 text-sm">POST {detail.endpoints.events}</p>
        <p className="mt-1 text-sm">Batch POST {detail.endpoints.batch}</p>
        <p className="mt-1 text-sm">
          Validate POST {detail.endpoints.validate}
        </p>
        {detail.authMode === "BEARER" ? (
          <pre className="mt-4 overflow-x-auto rounded-lg bg-slate-50 p-3 text-xs">
            {`Authorization: Bearer ${detail.maskedCredential}
Content-Type: application/json

{
  "eventId": "crm-event-98213",
  "externalLeadId": "quote_123",
  "sourceRecordId": "deal_5543",
  "status": "WON",
  "effectiveAt": "2026-08-31T14:23:00Z",
  "revenue": { "amount": "4500.00", "currency": "EUR" }
}`}
          </pre>
        ) : (
          <pre className="mt-4 overflow-x-auto rounded-lg bg-slate-50 p-3 text-xs">
            {`X-LeadGuard-Integration: ${detail.id}
X-LeadGuard-Event-Id: crm-event-98213
X-LeadGuard-Timestamp: <unix seconds>
X-LeadGuard-Signature: sha256=<hmac>

HMAC-SHA256(signingSecret, timestamp + "." + rawBody)
Replay window ±5 minutes. Statuses: NEW, QUALIFIED, WON, LOST.`}
          </pre>
        )}
        <p className="mt-3 text-sm text-[var(--muted)]">
          Revenue uses the same decimal + ISO currency rules as the lead outcome
          form. Duplicate event IDs are idempotent.
        </p>
      </section>

      {canManage ? (
        <OutcomeIntegrationSecretPanel
          organizationSlug={organizationSlug}
          integrationId={detail.id}
          maskedCredential={detail.maskedCredential}
          authMode={detail.authMode}
          status={detail.status}
        />
      ) : null}
    </div>
  );
}
