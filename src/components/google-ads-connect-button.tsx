"use client";

import { startGoogleAdsConnectAction } from "@/server/google-ads/actions";
import type { GoogleOAuthIntent } from "@/server/google-ads/scopes";

export function GoogleAdsConnectButton({
  organizationSlug,
  label,
  intent = "connect",
}: {
  organizationSlug: string;
  label: string;
  intent?: GoogleOAuthIntent;
}) {
  const action = startGoogleAdsConnectAction.bind(
    null,
    organizationSlug,
    intent,
  );
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
