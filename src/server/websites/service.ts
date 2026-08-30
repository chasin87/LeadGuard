import "server-only";

import { Prisma } from "@/generated/prisma/client";
import type { WebsiteDnsStatus, WebsiteStatus } from "@/generated/prisma/enums";
import { database } from "@/server/database";
import { requireOrganizationRole } from "@/server/authorization/organization";
import { createLogger } from "@/server/logger";
import { suggestedWebsiteName } from "@/lib/urls/normalize-url";
import {
  UrlValidationError,
  WebsiteNotFoundError,
} from "@/server/security/errors";
import {
  resolveSafeOutboundTarget,
  type DnsResolver,
} from "@/server/security/ssrf";

const logger = createLogger("websites");

export type WebsiteRecord = {
  id: string;
  organizationId: string;
  name: string;
  url: string;
  normalizedUrl: string;
  hostname: string;
  scheme: string;
  port: number;
  status: WebsiteStatus;
  dnsStatus: WebsiteDnsStatus;
  lastValidatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

const websiteSelect = {
  id: true,
  organizationId: true,
  name: true,
  url: true,
  normalizedUrl: true,
  hostname: true,
  scheme: true,
  port: true,
  status: true,
  dnsStatus: true,
  lastValidatedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

type WebsiteMutationOptions = {
  resolver?: DnsResolver;
};

function hostnameForLog(input: string): string {
  try {
    const trimmed = input.trim();
    const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    const parsed = new URL(candidate);
    return (parsed.hostname || "[unparseable]").slice(0, 253);
  } catch {
    return "[unparseable]";
  }
}

async function validateWebsiteTarget(
  url: string,
  context: { organizationId: string; userId: string },
  resolver?: DnsResolver,
) {
  try {
    return await resolveSafeOutboundTarget(url, {
      resolver,
      originOnly: true,
    });
  } catch (error) {
    if (error instanceof UrlValidationError) {
      logger.warn("website.validation_failed", {
        organizationId: context.organizationId,
        userId: context.userId,
        reason: error.reason,
        hostname: hostnameForLog(url),
      });
    }
    throw error;
  }
}

export async function listWebsites(
  userId: string,
  organizationSlug: string,
): Promise<WebsiteRecord[]> {
  const access = await requireOrganizationRole(
    userId,
    organizationSlug,
    "websites:read",
  );
  return database.website.findMany({
    where: { organizationId: access.organization.id },
    select: websiteSelect,
    orderBy: { createdAt: "asc" },
  });
}

export async function countWebsites(
  userId: string,
  organizationSlug: string,
): Promise<number> {
  const access = await requireOrganizationRole(
    userId,
    organizationSlug,
    "websites:read",
  );
  return database.website.count({
    where: { organizationId: access.organization.id },
  });
}

export async function getWebsite(
  userId: string,
  organizationSlug: string,
  websiteId: string,
): Promise<WebsiteRecord> {
  const access = await requireOrganizationRole(
    userId,
    organizationSlug,
    "websites:read",
  );
  const website = await database.website.findFirst({
    where: { id: websiteId, organizationId: access.organization.id },
    select: websiteSelect,
  });
  if (!website) {
    throw new WebsiteNotFoundError();
  }
  return website;
}

export async function createWebsite(
  input: {
    userId: string;
    organizationSlug: string;
    name: string;
    url: string;
  },
  options: WebsiteMutationOptions = {},
): Promise<WebsiteRecord> {
  const access = await requireOrganizationRole(
    input.userId,
    input.organizationSlug,
    "websites:manage",
  );
  const target = await validateWebsiteTarget(
    input.url,
    { organizationId: access.organization.id, userId: input.userId },
    options.resolver,
  );
  const name = input.name.trim() || suggestedWebsiteName(target.hostname);

  try {
    const website = await database.website.create({
      data: {
        organizationId: access.organization.id,
        name,
        url: target.normalizedUrl,
        normalizedUrl: target.normalizedUrl,
        hostname: target.hostname,
        scheme: target.scheme,
        port: target.port,
        dnsStatus: target.dnsStatus,
        lastValidatedAt: new Date(),
      },
      select: websiteSelect,
    });
    logger.info("website.created", {
      organizationId: access.organization.id,
      websiteId: website.id,
      userId: input.userId,
      hostname: website.hostname,
    });
    return website;
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new UrlValidationError(
        "This website is already added to your organization.",
        "duplicate_website",
      );
    }
    throw error;
  }
}

export async function updateWebsite(
  input: {
    userId: string;
    organizationSlug: string;
    websiteId: string;
    name: string;
    url: string;
    status: WebsiteStatus;
  },
  options: WebsiteMutationOptions = {},
): Promise<WebsiteRecord> {
  const existing = await getWebsiteForMutation(
    input.userId,
    input.organizationSlug,
    input.websiteId,
  );
  const target = await validateWebsiteTarget(
    input.url,
    { organizationId: existing.organizationId, userId: input.userId },
    options.resolver,
  );
  const name = input.name.trim() || suggestedWebsiteName(target.hostname);

  try {
    const updated = await database.website.updateMany({
      where: { id: existing.id, organizationId: existing.organizationId },
      data: {
        name,
        url: target.normalizedUrl,
        normalizedUrl: target.normalizedUrl,
        hostname: target.hostname,
        scheme: target.scheme,
        port: target.port,
        status: input.status,
        dnsStatus: target.dnsStatus,
        lastValidatedAt: new Date(),
      },
    });
    if (updated.count !== 1) {
      throw new WebsiteNotFoundError();
    }
    const website = await database.website.findFirst({
      where: { id: existing.id, organizationId: existing.organizationId },
      select: websiteSelect,
    });
    if (!website) {
      throw new WebsiteNotFoundError();
    }
    logger.info("website.updated", {
      organizationId: existing.organizationId,
      websiteId: website.id,
      userId: input.userId,
      hostname: website.hostname,
    });
    return website;
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new UrlValidationError(
        "This website is already added to your organization.",
        "duplicate_website",
      );
    }
    throw error;
  }
}

export async function setWebsiteStatus(input: {
  userId: string;
  organizationSlug: string;
  websiteId: string;
  status: WebsiteStatus;
}): Promise<WebsiteRecord> {
  const existing = await getWebsiteForMutation(
    input.userId,
    input.organizationSlug,
    input.websiteId,
  );
  const updated = await database.website.updateMany({
    where: { id: existing.id, organizationId: existing.organizationId },
    data: { status: input.status },
  });
  if (updated.count !== 1) {
    throw new WebsiteNotFoundError();
  }
  const website = await database.website.findFirst({
    where: { id: existing.id, organizationId: existing.organizationId },
    select: websiteSelect,
  });
  if (!website) {
    throw new WebsiteNotFoundError();
  }
  logger.info("website.updated", {
    organizationId: existing.organizationId,
    websiteId: website.id,
    userId: input.userId,
    hostname: website.hostname,
  });
  return website;
}

export async function deleteWebsite(input: {
  userId: string;
  organizationSlug: string;
  websiteId: string;
}): Promise<void> {
  const existing = await getWebsiteForMutation(
    input.userId,
    input.organizationSlug,
    input.websiteId,
  );
  await database.website.deleteMany({
    where: { id: existing.id, organizationId: existing.organizationId },
  });
  logger.info("website.deleted", {
    organizationId: existing.organizationId,
    websiteId: existing.id,
    userId: input.userId,
    hostname: existing.hostname,
  });
}

async function getWebsiteForMutation(
  userId: string,
  organizationSlug: string,
  websiteId: string,
): Promise<WebsiteRecord> {
  const access = await requireOrganizationRole(
    userId,
    organizationSlug,
    "websites:manage",
  );
  const website = await database.website.findFirst({
    where: { id: websiteId, organizationId: access.organization.id },
    select: websiteSelect,
  });
  if (!website) {
    throw new WebsiteNotFoundError();
  }
  return website;
}
