import { notFound } from "next/navigation";
import { requireOrganizationRole } from "@/server/authorization/organization";
import { database } from "@/server/database";
import { getArtifactStorage } from "@/server/storage";

export async function getAuthorizedCheckScreenshot(input: {
  userId: string;
  organizationSlug: string;
  checkId: string;
}): Promise<{ body: Buffer; contentType: string } | null> {
  const { organization } = await requireOrganizationRole(
    input.userId,
    input.organizationSlug,
    "monitors:read",
  );
  const check = await database.monitorCheck.findFirst({
    where: {
      id: input.checkId,
      monitor: {
        website: { organizationId: organization.id },
      },
    },
    select: {
      id: true,
      browserDetail: {
        select: { screenshotKey: true },
      },
      formDetail: {
        select: { screenshotKey: true },
      },
    },
  });
  if (!check) notFound();
  const key =
    check.browserDetail?.screenshotKey ?? check.formDetail?.screenshotKey;
  if (!key) return null;
  return getArtifactStorage().get(key);
}
