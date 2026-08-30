export default function GoogleAdsDestinationNotFound() {
  return (
    <div className="px-5 py-10 lg:px-10">
      <h1 className="text-3xl font-bold tracking-tight">
        Destination not found
      </h1>
      <p className="mt-3 max-w-xl text-[var(--muted)]">
        This Google Ads destination does not exist in this organization.
      </p>
    </div>
  );
}
