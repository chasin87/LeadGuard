import Link from "next/link";
import { requirePlatformPermission } from "@/server/platform-admin/require";
import { listPlatformUsers } from "@/server/platform-admin/queries";
import { PlatformConfirmForm } from "@/components/platform-confirm-form";
import { grantPlatformRoleAction } from "@/server/platform-admin/actions";
import { hasPlatformPermission } from "@/server/platform-admin/permissions";

export const metadata = { title: "Platform users" };

export default async function PlatformUsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requirePlatformPermission("platform:users:read");
  const params = await searchParams;
  const q = Array.isArray(params.q) ? params.q[0] : params.q;
  const cursor = Array.isArray(params.cursor)
    ? params.cursor[0]
    : params.cursor;
  const result = await listPlatformUsers({ q, cursor });
  const canRoles = hasPlatformPermission(actor.role, "platform:roles:manage");
  return (
    <div>
      <h1 className="text-2xl font-bold">Users</h1>
      <form className="mt-4 flex gap-2" method="get">
        <input
          className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Email, name, or user ID"
        />
        <button
          className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white"
          type="submit"
        >
          Search
        </button>
      </form>
      {result.rows.length === 0 ? (
        <p className="mt-6 text-[var(--muted)]">No users found</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-xl border border-[var(--border)] bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs text-[var(--muted)]">
              <tr>
                {[
                  "Name",
                  "Email",
                  "Memberships",
                  "Last login",
                  "Status",
                  "Platform",
                ].map((h) => (
                  <th key={h} className="px-3 py-2 text-left">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((user) => (
                <tr key={user.id} className="border-t border-[var(--border)]">
                  <td className="px-3 py-2">{user.name}</td>
                  <td className="px-3 py-2">
                    <Link href={`/platform-admin/users/${user.id}`}>
                      {user.email}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    {user.memberships
                      .map((m) => `${m.organization.name} (${m.role})`)
                      .join(", ") || "—"}
                  </td>
                  <td className="px-3 py-2">
                    {user.lastLoginAt?.toISOString().slice(0, 10) ?? "—"}
                  </td>
                  <td className="px-3 py-2">{user.status}</td>
                  <td className="px-3 py-2">
                    {user.platformAccess?.role ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canRoles ? (
        <div className="mt-6">
          <h2 className="font-semibold">Grant platform access</h2>
          <PlatformConfirmForm
            action={grantPlatformRoleAction}
            confirmLabel="Type GRANT"
            confirmValue="GRANT"
            hidden={{ confirm: "GRANT" }}
            fields={
              <>
                <label className="block text-sm font-semibold">
                  Email
                  <input
                    className="mt-1 w-full rounded-lg border border-[var(--border)] px-3 py-2"
                    name="email"
                    type="email"
                    required
                  />
                </label>
                <label className="block text-sm font-semibold">
                  Role
                  <select
                    className="mt-1 w-full rounded-lg border border-[var(--border)] px-3 py-2"
                    name="role"
                  >
                    <option value="SUPPORT">SUPPORT</option>
                    <option value="SUPER_ADMIN">SUPER_ADMIN</option>
                  </select>
                </label>
                <label className="block text-sm font-semibold">
                  Reason
                  <input
                    className="mt-1 w-full rounded-lg border border-[var(--border)] px-3 py-2"
                    name="reason"
                    required
                  />
                </label>
              </>
            }
            submitLabel="Grant role"
          />
        </div>
      ) : null}
    </div>
  );
}
