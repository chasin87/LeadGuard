import { requirePlatformPermission } from "@/server/platform-admin/require";
import { listPlatformAudit } from "@/server/platform-admin/queries";

export const metadata = { title: "Platform audit" };

export default async function PlatformAuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePlatformPermission("platform:audit:read");
  const params = await searchParams;
  const cursor = Array.isArray(params.cursor)
    ? params.cursor[0]
    : params.cursor;
  const result = await listPlatformAudit({ cursor });
  return (
    <div>
      <h1 className="text-2xl font-bold">Audit</h1>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Append-only. Secrets and click IDs are never stored here.
      </p>
      {result.rows.length === 0 ? (
        <p className="mt-4 text-[var(--muted)]">No audit events</p>
      ) : (
        <ul
          className="mt-4 space-y-2 rounded-xl border border-[var(--border)] bg-white p-4 text-sm"
          data-testid="audit-list"
        >
          {result.rows.map((row) => (
            <li key={row.id}>
              {row.createdAt.toISOString()} · {row.action} · {row.targetType}{" "}
              {row.targetId} · {row.reason ?? ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
