import { NextRequest } from "next/server";
import { getGoogleAdsConfig } from "@/server/google-ads/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (getGoogleAdsConfig().provider !== "fake") {
    return new Response("Not found", { status: 404 });
  }
  const state = request.nextUrl.searchParams.get("state") ?? "";
  const intent = request.nextUrl.searchParams.get("intent") ?? "connect";
  const encodedState = encodeURIComponent(state);
  const adsCallback = `/api/integrations/google-ads/callback?code=fake-google-ads-code&state=${encodedState}`;
  const dataManagerCallback = `/api/integrations/google-ads/callback?code=fake-google-ads-datamanager-code&state=${encodedState}`;
  const denyCallback = `/api/integrations/google-ads/callback?code=fake-google-ads-deny-datamanager-code&state=${encodedState}`;
  const dataManager = intent === "data_manager";
  return new Response(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Fake Google Ads consent</title>
  </head>
  <body>
    <h1>${dataManager ? "Enable conversion feedback" : "Connect LeadGuard to Google Ads"}</h1>
    <p>This is the local fake OAuth provider. No Google account is contacted.</p>
    ${
      dataManager
        ? `<p>Additional Google permission required for Data Manager conversion uploads.</p>
    <p><a href="${dataManagerCallback}">Approve conversion feedback</a></p>
    <p><a href="${denyCallback}">Continue without conversion feedback</a></p>`
        : `<p><a href="${adsCallback}">Approve and continue</a></p>`
    }
  </body>
</html>`,
    {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    },
  );
}
