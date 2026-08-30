import { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { createLogger } from "@/server/logger";
import { DomainError } from "@/server/authorization/errors";
import {
  AuthorizationError,
  UnauthenticatedError,
} from "@/server/authorization/errors";
import { completeGoogleAdsOAuth } from "@/server/google-ads/oauth";
import { discoverGoogleAdsAccounts } from "@/server/google-ads/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const logger = createLogger("google-ads");

export async function GET(request: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  const code = request.nextUrl.searchParams.get("code") ?? "";
  const state = request.nextUrl.searchParams.get("state") ?? "";
  if (!userId) {
    redirect("/login");
  }
  if (!code || !state) {
    redirect("/app");
  }
  let organizationSlug: string;
  try {
    const result = await completeGoogleAdsOAuth({
      userId,
      code,
      state,
    });
    await discoverGoogleAdsAccounts({
      userId,
      organizationSlug: result.organizationSlug,
    });
    organizationSlug = result.organizationSlug;
  } catch (error) {
    if (error instanceof UnauthenticatedError) redirect("/login");
    if (error instanceof AuthorizationError) {
      logger.warn("google_ads.oauth.forbidden", { userId });
      redirect("/app");
    }
    logger.warn("google_ads.oauth.failed", {
      userId,
      message: error instanceof DomainError ? error.message : "oauth_failed",
    });
    redirect("/app");
  }
  redirect(`/app/${organizationSlug}/integrations/google-ads`);
}
