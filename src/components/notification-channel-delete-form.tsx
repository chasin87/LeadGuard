"use client";

import { deleteNotificationChannelAction } from "@/server/notifications/actions";

export function NotificationChannelDeleteForm({
  organizationSlug,
  channelId,
}: {
  organizationSlug: string;
  channelId: string;
}) {
  const action = deleteNotificationChannelAction.bind(
    null,
    organizationSlug,
    channelId,
  );

  return (
    <form action={action}>
      <button
        className="rounded-xl border border-red-200 px-4 py-2 text-sm font-semibold text-red-800 hover:bg-red-50"
        type="submit"
      >
        Delete channel
      </button>
    </form>
  );
}
