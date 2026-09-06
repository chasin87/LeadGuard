import { hasOrganizationPermission } from "@/server/authorization/permissions";
import { loadOrganizationAccess } from "@/server/authorization/organization";
import { AuthorizationError } from "@/server/authorization/errors";
import { WebsiteNotFoundError } from "@/server/security/errors";
import { database } from "@/server/database";
import {
  disableWebsiteTracking,
  enableWebsiteTracking,
  rotatePublicSiteKey,
  rotateServerIngestionSecret,
} from "@/server/tracking/service";

async function requireWebsiteManage(
  userId: string,
  organizationSlug: string,
  websiteId: string,
) {
  const access = await loadOrganizationAccess(userId, organizationSlug);
  if (access.status !== "ok") {
    throw new AuthorizationError();
  }
  if (
    !hasOrganizationPermission(
      access.context.membership.role,
      "websites:manage",
    )
  ) {
    throw new AuthorizationError();
  }
  const website = await database.website.findFirst({
    where: { id: websiteId, organizationId: access.context.organization.id },
  });
  if (!website) throw new WebsiteNotFoundError();
  return { organization: access.context.organization, website };
}

export async function enableTrackingForWebsite(input: {
  userId: string;
  organizationSlug: string;
  websiteId: string;
}) {
  const { organization, website } = await requireWebsiteManage(
    input.userId,
    input.organizationSlug,
    input.websiteId,
  );
  return enableWebsiteTracking({
    organizationId: organization.id,
    websiteId: website.id,
  });
}

export async function disableTrackingForWebsite(input: {
  userId: string;
  organizationSlug: string;
  websiteId: string;
}) {
  const { website } = await requireWebsiteManage(
    input.userId,
    input.organizationSlug,
    input.websiteId,
  );
  return disableWebsiteTracking(website.id);
}

export async function rotateTrackingSecretsForWebsite(input: {
  userId: string;
  organizationSlug: string;
  websiteId: string;
  kind: "site" | "server";
}) {
  const { website } = await requireWebsiteManage(
    input.userId,
    input.organizationSlug,
    input.websiteId,
  );
  if (input.kind === "site") {
    return { siteKey: await rotatePublicSiteKey(website.id) };
  }
  return { serverSecret: await rotateServerIngestionSecret(website.id) };
}
