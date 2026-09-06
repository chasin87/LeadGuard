import { notFound } from "next/navigation";
import Link from "next/link";
import { requirePlatformPermission } from "@/server/platform-admin/require";
import { getPlatformUser } from "@/server/platform-admin/queries";
import { hasPlatformPermission } from "@/server/platform-admin/permissions";
import { PlatformConfirmForm } from "@/components/platform-confirm-form";
import {
  disableUserAction,
  reactivateUserAction,
  revokePlatformRoleAction,
} from "@/server/platform-admin/actions";

export const metadata = { title: "Platform user" };

export default async function PlatformUserDetailPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const actor = await requirePlatformPermission("platform:users:read");
  const { userId } = await params;
  const user = await getPlatformUser(userId);
  if (!user) notFound();
  const canManage = hasPlatformPermission(actor.role, "platform:users:manage");
  const canRoles = hasPlatformPermission(actor.role, "platform:roles:manage");
  return (
    <div>
      <p className="text-sm">
        <Link href="/platform-admin/users">Users</Link>
      </p>
      <h1 className="mt-2 text-2xl font-bold">{user.name}</h1>
      <section className="mt-4 space-y-1 rounded-xl border border-[var(--border)] bg-white p-4 text-sm">
        <p>Email: {user.email}</p>
        <p>Created: {user.createdAt.toISOString()}</p>
        <p>Last login: {user.lastLoginAt?.toISOString() ?? "never"}</p>
        <p>Email verified: {user.emailVerified ? "yes" : "not used"}</p>
        <p>Password reset: tokens are never shown</p>
        <p>Status: {user.status}</p>
        <p>
          Platform: {user.platformAccess?.role ?? "none"} (
          {user.platformAccess?.status ?? "n/a"})
        </p>
      </section>
      <section className="mt-4 rounded-xl border border-[var(--border)] bg-white p-4 text-sm">
        <h2 className="font-semibold">Memberships</h2>
        <ul className="mt-2">
          {user.memberships.map((membership) => (
            <li key={membership.organization.id}>
              <Link
                href={`/platform-admin/organizations/${membership.organization.id}`}
              >
                {membership.organization.name}
              </Link>{" "}
              ({membership.role}) joined{" "}
              {membership.createdAt.toISOString().slice(0, 10)}
            </li>
          ))}
        </ul>
      </section>
      {canManage ? (
        user.status === "ACTIVE" ? (
          <PlatformConfirmForm
            action={disableUserAction}
            confirmLabel={`Type ${user.email} to disable`}
            confirmValue={user.email}
            hidden={{ userId: user.id }}
            fields={
              <label className="block text-sm font-semibold">
                Reason
                <input
                  className="mt-1 w-full rounded-lg border border-[var(--border)] px-3 py-2"
                  name="reason"
                  required
                />
              </label>
            }
            submitLabel={`Disable ${user.email}?`}
          />
        ) : (
          <PlatformConfirmForm
            action={reactivateUserAction}
            confirmLabel={`Type ${user.email} to reactivate`}
            confirmValue={user.email}
            hidden={{ userId: user.id }}
            fields={
              <label className="block text-sm font-semibold">
                Reason
                <input
                  className="mt-1 w-full rounded-lg border border-[var(--border)] px-3 py-2"
                  name="reason"
                  required
                />
              </label>
            }
            submitLabel="Reactivate user"
          />
        )
      ) : null}
      {canRoles && user.platformAccess?.status === "ACTIVE" ? (
        <PlatformConfirmForm
          action={revokePlatformRoleAction}
          confirmLabel="Type REVOKE"
          confirmValue="REVOKE"
          hidden={{ userId: user.id }}
          fields={
            <label className="block text-sm font-semibold">
              Reason
              <input
                className="mt-1 w-full rounded-lg border border-[var(--border)] px-3 py-2"
                name="reason"
                required
              />
            </label>
          }
          submitLabel="Revoke platform access"
        />
      ) : null}
    </div>
  );
}
