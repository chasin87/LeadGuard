import Link from "next/link";
import { hasOrganizationPermission } from "@/server/authorization/permissions";
import { loadOrganizationAccess } from "@/server/authorization/organization";
import { requireUser } from "@/server/authorization/session";
import { CreateOutcomeIntegrationForm } from "@/components/outcome-integration-create-form";
import { OutcomeImportUploadForm } from "@/components/outcome-import-upload-form";
import { OutcomeUnmatchedList } from "@/components/outcome-unmatched-list";
import {
  listOutcomeEvents,
  listOutcomeImports,
  listOutcomeIntegrations,
  listUnmatchedOutcomeEvents,
  unmatchedOutcomeCount,
} from "@/server/outcomes/queries";
import { database } from "@/server/database";
import { formatRelativeTime } from "@/lib/monitoring/display";

export const metadata = { title: "Outcome ingestion" };

export default async function OutcomeIngestionPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationSlug: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { organizationSlug } = await params;
  const { tab = "integrations" } = await searchParams;
  const user = await requireUser();
  const access = await loadOrganizationAccess(user.id, organizationSlug);
  if (access.status !== "ok") return null;
  const organizationId = access.context.organization.id;
  const canManage = hasOrganizationPermission(
    access.context.membership.role,
    "integrations:manage",
  );
  const canManageLeads = hasOrganizationPermission(
    access.context.membership.role,
    "leads:manage",
  );
  const [integrations, unmatched, events, imports, unmatchedCount, websites] =
    await Promise.all([
      listOutcomeIntegrations(organizationId),
      listUnmatchedOutcomeEvents(organizationId),
      listOutcomeEvents(organizationId),
      listOutcomeImports(organizationId),
      unmatchedOutcomeCount(organizationId),
      database.website.findMany({
        where: { organizationId },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
    ]);
  const tabs = [
    { id: "integrations", label: "Integrations" },
    { id: "imports", label: "Imports" },
    {
      id: "unmatched",
      label: `Unmatched${unmatchedCount ? ` (${unmatchedCount})` : ""}`,
    },
    { id: "history", label: "History" },
  ] as const;

  return (
    <div className="px-5 py-10 lg:px-10">
      <p className="text-sm">
        <Link
          className="font-semibold text-[#19d0a2] hover:underline"
          href={`/app/${organizationSlug}/integrations`}
        >
          Integrations
        </Link>
      </p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">
        Outcome ingestion
      </h1>
      <p className="mt-2 max-w-2xl text-[var(--muted)]">
        Send Won/Lost and revenue for existing leads. Matching is exact only.
        Unmatched events never create a lead.
      </p>
      <nav className="mt-6 flex flex-wrap gap-2" aria-label="Outcome sections">
        {tabs.map((item) => (
          <Link
            key={item.id}
            className={`rounded-lg px-3 py-2 text-sm font-semibold ${
              tab === item.id ? "bg-slate-900 text-white" : "bg-slate-100"
            }`}
            href={`/app/${organizationSlug}/integrations/outcomes?tab=${item.id}`}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      {tab === "integrations" ? (
        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_320px]">
          <section className="space-y-4">
            {integrations.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">
                No outcome integrations yet.
              </p>
            ) : (
              integrations.map((item) => (
                <Link
                  key={item.id}
                  className="block rounded-2xl border border-[var(--border)] bg-white p-5"
                  href={`/app/${organizationSlug}/integrations/outcomes/${item.id}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="font-bold">{item.name}</h2>
                    <span className="text-sm font-semibold">
                      {item.attention}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    {item.type} · {item.authMode} · {item.sourceSystem} ·{" "}
                    {item.maskedCredential}
                  </p>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    Websites:{" "}
                    {item.websites.map((website) => website.name).join(", ") ||
                      "none"}
                  </p>
                </Link>
              ))
            )}
          </section>
          {canManage ? (
            <CreateOutcomeIntegrationForm
              organizationSlug={organizationSlug}
              websites={websites}
            />
          ) : null}
        </div>
      ) : null}

      {tab === "imports" ? (
        <div className="mt-8 space-y-6">
          {canManageLeads ? (
            <OutcomeImportUploadForm
              organizationSlug={organizationSlug}
              integrations={integrations.map((item) => ({
                id: item.id,
                name: item.name,
              }))}
            />
          ) : null}
          <section className="space-y-3">
            {imports.map((item) => (
              <Link
                key={item.id}
                className="block rounded-2xl border border-[var(--border)] bg-white p-5"
                href={`/app/${organizationSlug}/integrations/outcomes/imports/${item.id}`}
              >
                <p className="font-semibold">{item.fileName}</p>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  {item.status} · {item.processedRows}/{item.totalRows} rows ·{" "}
                  {item.integration.name}
                </p>
              </Link>
            ))}
          </section>
        </div>
      ) : null}

      {tab === "unmatched" ? (
        <div className="mt-8">
          <OutcomeUnmatchedList
            organizationSlug={organizationSlug}
            events={unmatched.map((item) => ({
              id: item.id,
              sourceSystem: item.sourceSystem,
              sourceRecordId: item.sourceRecordId,
              externalLeadId: item.externalLeadId,
              status: item.normalizedStatus,
              hasRevenue: item.hasRevenue,
              currency: item.revenueCurrencyCode,
              receivedAtLabel: formatRelativeTime(item.receivedAt),
              integrationName: item.integration.name,
            }))}
            websites={websites}
            canManage={canManageLeads}
          />
        </div>
      ) : null}

      {tab === "history" ? (
        <section className="mt-8 space-y-3">
          {events.map((item) => (
            <article
              key={item.id}
              className="rounded-2xl border border-[var(--border)] bg-white p-5"
            >
              <p className="font-semibold">
                {item.status}
                {item.normalizedStatus ? ` · ${item.normalizedStatus}` : ""}
              </p>
              <p className="mt-1 text-sm text-[var(--muted)]">
                {item.integration.name} · event {item.sourceEventId} · received{" "}
                {formatRelativeTime(item.receivedAt)}
              </p>
              <p className="mt-1 text-sm text-[var(--muted)]">
                External ID {item.externalLeadId ?? "—"} · source record{" "}
                {item.sourceRecordId ?? "—"}
                {item.hasRevenue
                  ? ` · revenue ${item.revenueCurrencyCode ?? ""}`
                  : ""}
              </p>
            </article>
          ))}
        </section>
      ) : null}
    </div>
  );
}
