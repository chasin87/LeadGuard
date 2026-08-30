"use client";

import { startGoogleAdsConnectAction } from "@/server/google-ads/actions";

export function GoogleAdsConnectButton({
  organizationSlug,
  label,
}: {
  organizationSlug: string;
  label: string;
}) {
  const action = startGoogleAdsConnectAction.bind(null, organizationSlug);
  return (
    <form action={action}>
      <button
        className="rounded-xl bg-[#19d0a2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#193f36]"
        type="submit"
      >
        {label}
      </button>
    </form>
  );
}
