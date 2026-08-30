import Link from "next/link";
import { notFound } from "next/navigation";
import { NotificationChannelDeleteForm } from "@/components/notification-channel-delete-form";
import { NotificationChannelSettingsForm } from "@/components/notification-channel-settings-form";
import { NotificationTestButton } from "@/components/notification-test-button";
import { NotificationWebhookSecretControls } from "@/components/notification-webhook-secret-controls";
import { hasOrganizationPermission } from "@/server/authorization/permissions";
import { loadOrganizationAccess } from "@/server/authorization/organization";
import { requireUser } from "@/server/authorization/session";
import { getNotificationChannel } from "@/server/notifications/queries";
import { NotificationChannelNotFoundError } from "@/server/security/errors";

export const metadata = { title: "Edit notification channel" };

export default async function NotificationChannelPage({
  params,
}: {
  params: Promise<{ organizationSlug: string; channelId: string }>;
}) {
  const { organizationSlug, channelId } = await params;
  const user = await requireUser();
  const access = await loadOrganizationAccess(user.id, organizationSlug);
  if (access.status !== "ok") return null;

  const canManage = hasOrganizationPermission(
    access.context.membership.role,
    "notifications:manage",
  );

  let channel;
  try {
    channel = await getNotificationChannel(
      user.id,
      organizationSlug,
      channelId,
    );
  } catch (error) {
    if (error instanceof NotificationChannelNotFoundError) notFound();
    throw error;
  }

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
      <h1 className="mt-2 text-3xl font-bold tracking-tight">{channel.name}</h1>
      <p className="mt-2 text-[var(--muted)]">
        {channel.type === "EMAIL" ? "Email channel" : "Webhook channel"}
      </p>

      {canManage ? (
        <>
          <section className="mt-8 max-w-xl rounded-2xl border border-[var(--border)] bg-white p-6">
            <NotificationChannelSettingsForm
              organizationSlug={organizationSlug}
              channelId={channel.id}
              type={channel.type}
              name={channel.name}
              emailAddress={channel.emailAddress}
              webhookUrl={channel.webhookUrl}
              notifyOnOpened={channel.notifyOnOpened}
              notifyOnResolved={channel.notifyOnResolved}
              status={channel.status}
            />
          </section>
          <section className="mt-6 max-w-xl rounded-2xl border border-[var(--border)] bg-white p-6">
            <h2 className="text-lg font-bold">Send test</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              This does not open an incident.
            </p>
            <div className="mt-4">
              <NotificationTestButton
                organizationSlug={organizationSlug}
                channelId={channel.id}
              />
            </div>
          </section>
          {channel.type === "WEBHOOK" ? (
            <section className="mt-6 max-w-xl rounded-2xl border border-[var(--border)] bg-white p-6">
              <h2 className="text-lg font-bold">Signing secret</h2>
              <div className="mt-4">
                <NotificationWebhookSecretControls
                  organizationSlug={organizationSlug}
                  channelId={channel.id}
                />
              </div>
            </section>
          ) : null}
          <section className="mt-6 max-w-xl rounded-2xl border border-red-200 bg-white p-6">
            <h2 className="text-lg font-bold">Delete</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Delivery history is kept. The channel stops receiving new alerts.
            </p>
            <div className="mt-4">
              <NotificationChannelDeleteForm
                organizationSlug={organizationSlug}
                channelId={channel.id}
              />
            </div>
          </section>
        </>
      ) : (
        <section className="mt-8 max-w-xl rounded-2xl border border-[var(--border)] bg-white p-6">
          <p className="text-sm text-[var(--muted)]">
            {channel.type === "EMAIL"
              ? channel.emailAddress
              : channel.webhookDisplayUrl}
          </p>
          <p className="mt-3 text-sm">
            Incident opened {channel.notifyOnOpened ? "ON" : "OFF"}. Incident
            resolved {channel.notifyOnResolved ? "ON" : "OFF"}.
          </p>
          <p className="mt-4 text-sm text-[var(--muted)]">
            Members can view notification settings but cannot change them.
          </p>
        </section>
      )}
    </div>
  );
}
