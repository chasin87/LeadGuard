import Link from "next/link";
import { NotificationEmailCreateForm } from "@/components/notification-email-create-form";
import { NotificationWebhookCreateForm } from "@/components/notification-webhook-create-form";
import { hasOrganizationPermission } from "@/server/authorization/permissions";
import { loadOrganizationAccess } from "@/server/authorization/organization";
import { requireUser } from "@/server/authorization/session";

export const metadata = { title: "Add notification channel" };

export default async function NewNotificationChannelPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  const user = await requireUser();
  const access = await loadOrganizationAccess(user.id, organizationSlug);
  if (access.status !== "ok") return null;

  const canManage = hasOrganizationPermission(
    access.context.membership.role,
    "notifications:manage",
  );

  return (
    <div className="px-5 py-10 lg:px-10">
      <p className="text-sm">
        <Link
          className="font-semibold text-[#19d0a2] hover:underline"
          href={`/app/${organizationSlug}/settings/notifications`}
        >
          Notifications
        </Link>
      </p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">
        Add notification channel
      </h1>
      {canManage ? (
        <div className="mt-8 grid max-w-4xl gap-6 lg:grid-cols-2">
          <section className="rounded-2xl border border-[var(--border)] bg-white p-6">
            <h2 className="text-lg font-bold">Email</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Send alerts to an operations or owner mailbox.
            </p>
            <div className="mt-5">
              <NotificationEmailCreateForm
                organizationSlug={organizationSlug}
              />
            </div>
          </section>
          <section className="rounded-2xl border border-[var(--border)] bg-white p-6">
            <h2 className="text-lg font-bold">Webhook</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              POST a signed JSON payload to your automation endpoint.
            </p>
            <div className="mt-5">
              <NotificationWebhookCreateForm
                organizationSlug={organizationSlug}
              />
            </div>
          </section>
        </div>
      ) : (
        <p className="mt-4 max-w-xl text-[var(--muted)]">
          Only owners and admins can add notification channels.
        </p>
      )}
    </div>
  );
}
