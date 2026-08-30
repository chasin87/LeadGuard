import { notFound } from "next/navigation";
import { NextResponse } from "next/server";
import { requireUser } from "@/server/authorization/session";
import { getAuthorizedCheckScreenshot } from "@/server/monitoring/browser/screenshot-access";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: {
    params: Promise<{ organizationSlug: string; checkId: string }>;
  },
) {
  const user = await requireUser();
  const { organizationSlug, checkId } = await context.params;
  const artifact = await getAuthorizedCheckScreenshot({
    userId: user.id,
    organizationSlug,
    checkId,
  });
  if (!artifact) notFound();
  return new NextResponse(new Uint8Array(artifact.body), {
    headers: {
      "Content-Type": artifact.contentType,
      "Cache-Control": "private, max-age=60",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
