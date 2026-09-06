import Link from "next/link";
import { notFound } from "next/navigation";
import { hasOrganizationPermission } from "@/server/authorization/permissions";
import { loadOrganizationAccess } from "@/server/authorization/organization";
import { requireUser } from "@/server/authorization/session";
import { database } from "@/server/database";
import { previewOutcomeImport } from "@/server/outcomes/import-service";
import { OutcomeImportMapper } from "@/components/outcome-import-mapper";

export const metadata = { title: "Outcome import" };

export default async function OutcomeImportDetailPage({
  params,
}: {
  params: Promise<{ organizationSlug: string; importId: string }>;
}) {
  const { organizationSlug, importId } = await params;
  const user = await requireUser();
  const access = await loadOrganizationAccess(user.id, organizationSlug);
  if (access.status !== "ok") return null;
  const record = await database.outcomeImport.findFirst({
    where: {
      id: importId,
      organizationId: access.context.organization.id,
    },
  });
  if (!record) notFound();
  const canManage = hasOrganizationPermission(
    access.context.membership.role,
    "leads:manage",
  );
  const preview = await previewOutcomeImport({
    userId: user.id,
    organizationSlug,
    importId,
    dryRun: record.status === "PREVIEWED" || record.status === "UPLOADED",
  });
  const defaultCurrency =
    access.context.organization.defaultRevenueCurrencyCode;

  return (
    <div className="px-5 py-10 lg:px-10">
      <p className="text-sm">
        <Link
          className="font-semibold text-[#19d0a2] hover:underline"
          href={`/app/${organizationSlug}/integrations/outcomes?tab=imports`}
        >
          Imports
        </Link>
      </p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">
        {record.fileName}
      </h1>
      <p className="mt-2 text-[var(--muted)]">
        {record.status} · {record.processedRows}/{record.totalRows} processed ·
        applied {record.appliedRows} · unmatched {record.unmatchedRows} ·
        rejected {record.rejectedRows}
      </p>
      {canManage &&
      (record.status === "UPLOADED" || record.status === "PREVIEWED") ? (
        <OutcomeImportMapper
          organizationSlug={organizationSlug}
          importId={record.id}
          headers={preview.headers}
          defaultCurrency={defaultCurrency}
          preview={preview.preview}
        />
      ) : (
        <p className="mt-6 text-sm text-[var(--muted)]">
          Preview is a snapshot. Confirm always re-validates on the server.
        </p>
      )}
    </div>
  );
}
