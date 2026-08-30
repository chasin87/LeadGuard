import Link from "next/link";
import { NotificationTestButton } from "@/components/notification-test-button";
import { hasOrganizationPermission } from "@/server/authorization/permissions";
import { loadOrganizationAccess } from "@/server/authorization/organization";
import { requireUser } from "@/server/authorization/session";
import { listNotificationChannels } from "@/server/notifications/queries";

export const metadata = { title: "Notifications" };

function formatStamp(date: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date);
}

export default async function NotificationSettingsPage({
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
  const channels = await listNotificationChannels(user.id, organizationSlug);

  return (
    <div className="px-5 py-10 lg:px-10">
      <p className="text-sm">
        <Link
          className="font-semibold text-[#19d0a2] hover:underline"
          href={`/app/${organizationSlug}/settings`}
        >
          Settings
        </Link>
      </p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">Notifications</h1>
      <p className="mt-2 max-w-2xl text-[var(--muted)]">
        Receive alerts when LeadGuard detects or resolves incidents.
      </p>

      {canManage ? (
        <p className="mt-4">
          <Link
            className="font-semibold text-[#19d0a2] hover:underline"
            href={`/app/${organizationSlug}/settings/notifications/new`}
          >
            Add notification channel
          </Link>
        </p>
      ) : null}

      {channels.length === 0 ? (
        <section className="mt-8 max-w-xl rounded-2xl border border-[var(--border)] bg-white p-6">
          <h2 className="text-lg font-bold">
            No notification channels configured
          </h2>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Add a notification channel so LeadGuard can alert you when a
            monitored service goes down or recovers.
          </p>
          {canManage ? (
            <p className="mt-4">
              <Link
                className="rounded-xl bg-[#19d0a2] px-5 py-3 font-semibold text-white hover:bg-[#193f36]"
                href={`/app/${organizationSlug}/settings/notifications/new`}
              >
                Add notification channel
              </Link>
            </p>
          ) : null}
        </section>
      ) : (
        <ul className="mt-8 max-w-2xl space-y-4">
          {channels.map((channel) => (
            <li
              className="rounded-2xl border border-[var(--border)] bg-white p-6"
              key={channel.id}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                    {channel.type === "EMAIL" ? "Email" : "Webhook"}
                  </p>
                  <h2 className="mt-1 text-lg font-bold">{channel.name}</h2>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    {channel.type === "EMAIL"
                      ? channel.emailAddress
                      : channel.webhookDisplayUrl}
                  </p>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold">
                  {channel.status === "ACTIVE" ? "Active" : "Disabled"}
                </span>
              </div>
              <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-[var(--muted)]">Incident opened</dt>
                  <dd className="font-semibold">
                    {channel.notifyOnOpened ? "ON" : "OFF"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--muted)]">Incident resolved</dt>
                  <dd className="font-semibold">
                    {channel.notifyOnResolved ? "ON" : "OFF"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--muted)]">
                    Last successful delivery
                  </dt>
                  <dd>
                    {channel.lastSentAt
                      ? `${formatStamp(channel.lastSentAt)} UTC`
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--muted)]">Last failed delivery</dt>
                  <dd>
                    {channel.lastFailedAt
                      ? `${formatStamp(channel.lastFailedAt)} UTC`
                      : "—"}
                  </dd>
                </div>
              </dl>
              {canManage ? (
                <div className="mt-4 flex flex-wrap items-start gap-4">
                  <NotificationTestButton
                    organizationSlug={organizationSlug}
                    channelId={channel.id}
                  />
                  <Link
                    className="rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-semibold hover:bg-slate-50"
                    href={`/app/${organizationSlug}/settings/notifications/${channel.id}`}
                  >
                    Edit
                  </Link>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
