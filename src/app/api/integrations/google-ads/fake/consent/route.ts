import { NextRequest } from "next/server";
import { getGoogleAdsConfig } from "@/server/google-ads/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (getGoogleAdsConfig().provider !== "fake") {
    return new Response("Not found", { status: 404 });
  }
  const state = request.nextUrl.searchParams.get("state") ?? "";
  const callback = `/api/integrations/google-ads/callback?code=fake-google-ads-code&state=${encodeURIComponent(state)}`;
  return new Response(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Fake Google Ads consent</title>
  </head>
  <body>
    <h1>Connect LeadGuard to Google Ads</h1>
    <p>This is the local fake OAuth provider. No Google account is contacted.</p>
    <p><a href="${callback}">Approve and continue</a></p>
  </body>
</html>`,
    {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    },
  );
}
