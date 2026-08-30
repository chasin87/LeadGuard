export default function NotificationChannelNotFound() {
  return (
    <div className="px-5 py-10 lg:px-10">
      <h1 className="text-2xl font-bold">Notification channel not found</h1>
      <p className="mt-2 text-[var(--muted)]">
        This channel is not available in this organization.
      </p>
    </div>
  );
}
