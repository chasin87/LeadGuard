import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AuthorizationError, DomainError } from "@/server/authorization/errors";
import { database } from "@/server/database";
import { persistAndProcessCheck } from "@/server/incidents/engine";
import {
  completeGoogleAdsOAuth,
  startGoogleAdsOAuth,
} from "@/server/google-ads/oauth";
import {
  disconnectGoogleAds,
  enqueueManualGoogleAdsImpact,
  selectGoogleAdsCustomers,
} from "@/server/google-ads/service";
import { executeGoogleAdsImpactJob } from "@/server/google-ads/impact/refresh";
import { resetFakeGoogleAdsWorld } from "@/server/google-ads/fake-provider";
import { createWebsite } from "@/server/websites/service";
import {
  createTestOwner,
  createTestUser,
  deleteTestData,
} from "@/test/helpers";
import { zonedLocalToUtc } from "@/server/google-ads/impact/timezone";
import type { DnsResolver } from "@/server/security/ssrf";

const userIds: string[] = [];
const organizationIds: string[] = [];
const publicResolver: DnsResolver = async () => ["93.184.216.34"];

afterAll(async () => {
  await deleteTestData({ userIds, organizationIds });
});

beforeEach(() => {
  resetFakeGoogleAdsWorld();
});

async function connectOwner(name: string) {
  const owner = await createTestOwner(name);
  userIds.push(owner.user.id);
  organizationIds.push(owner.organization.id);
  const url = await startGoogleAdsOAuth({
    userId: owner.user.id,
    organizationSlug: owner.organization.slug,
  });
  const state = new URL(url, "http://localhost:3000").searchParams.get(
    "state",
  )!;
  await completeGoogleAdsOAuth({
    userId: owner.user.id,
    code: "fake-google-ads-code",
    state,
  });
  const { discoverGoogleAdsAccounts } =
    await import("@/server/google-ads/service");
  await discoverGoogleAdsAccounts({
    userId: owner.user.id,
    organizationSlug: owner.organization.slug,
  });
  return owner;
}

const failure = {
  status: "FAILURE" as const,
  httpStatus: 404,
  responseTimeMs: 80,
  requestedUrl: "https://example.nl/airco",
  finalUrl: "https://example.nl/airco",
  redirectCount: 0,
  resolvedIp: "93.184.216.34",
  errorType: "HTTP_404" as const,
  errorMessage: "HTTP 404",
};

async function openAircoIncident(name: string) {
  const owner = await connectOwner(name);
  await createWebsite(
    {
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
      name: "Example NL",
      url: "https://example.nl",
    },
    { resolver: publicResolver },
  );
  await selectGoogleAdsCustomers({
    userId: owner.user.id,
    organizationSlug: owner.organization.slug,
    googleCustomerIds: ["2222222222"],
  });
  const target = await database.googleAdsDestinationTarget.findFirstOrThrow({
    where: {
      organizationId: owner.organization.id,
      normalizedUrl: "https://example.nl/airco",
    },
  });
  const startedAt = zonedLocalToUtc("Europe/Amsterdam", 2026, 8, 30, 14, 15);
  const detectedAt = zonedLocalToUtc("Europe/Amsterdam", 2026, 8, 30, 14, 20);
  await persistAndProcessCheck({
    monitorId: target.monitorId!,
    organizationId: owner.organization.id,
    websiteId: target.websiteId!,
    startedAt,
    finishedAt: startedAt,
    result: failure,
  });
  await persistAndProcessCheck({
    monitorId: target.monitorId!,
    organizationId: owner.organization.id,
    websiteId: target.websiteId!,
    startedAt: detectedAt,
    finishedAt: detectedAt,
    result: failure,
  });
  const incident = await database.incident.findFirstOrThrow({
    where: { monitorId: target.monitorId! },
  });
  return { owner, target, incident };
}

describe("Google Ads incident impact", () => {
  it("uses startedAt not detectedAt and creates one impact", async () => {
    const { incident } = await openAircoIncident("Impact Window");
    expect(incident.startedAt.toISOString()).toBe(
      zonedLocalToUtc("Europe/Amsterdam", 2026, 8, 30, 14, 15).toISOString(),
    );
    expect(incident.detectedAt.getTime()).toBeGreaterThan(
      incident.startedAt.getTime(),
    );
    const impact = await database.googleAdsIncidentImpact.findUniqueOrThrow({
      where: { incidentId: incident.id },
    });
    expect(impact.windowStartedAt.toISOString()).toBe(
      incident.startedAt.toISOString(),
    );
    expect(impact.isProvisional).toBe(true);
    expect(impact.windowEndedAt?.getTime()).toBeGreaterThan(
      incident.detectedAt.getTime(),
    );
    expect(impact.windowCostMicros).toBe(165_000_000n);
    expect(impact.windowClicksEstimated).toBe(true);
    expect(impact.attributionMethod).toBe("MIXED");
    expect(impact.status).toBe("PARTIAL");
  });

  it("treats a metrics API failure as ERROR without a new incident", async () => {
    resetFakeGoogleAdsWorld({ failMetricsFor: ["2222222222"] });
    const { owner, incident } = await openAircoIncident("Impact Api Error");
    const impact = await database.googleAdsIncidentImpact.findUniqueOrThrow({
      where: { incidentId: incident.id },
    });
    expect(impact.status).toBe("ERROR");
    expect(
      await database.incident.count({
        where: {
          monitor: { website: { organizationId: owner.organization.id } },
        },
      }),
    ).toBe(1);
  });

  it("marks impact unavailable on reauth without changing destination health", async () => {
    const { owner, incident, target } =
      await openAircoIncident("Impact Reauth");
    await database.googleAdsConnection.update({
      where: { organizationId: owner.organization.id },
      data: { status: "REAUTH_REQUIRED" },
    });
    await executeGoogleAdsImpactJob({
      incidentId: incident.id,
      reason: "refresh",
    });
    const impact = await database.googleAdsIncidentImpact.findUniqueOrThrow({
      where: { incidentId: incident.id },
    });
    expect(impact.status).toBe("UNAVAILABLE");
    expect(impact.diagnosticCode).toBe("REAUTH_REQUIRED");
    const monitor = await database.monitor.findUniqueOrThrow({
      where: { id: target.monitorId! },
    });
    expect(monitor.consecutiveFailures).toBeGreaterThan(0);
  });

  it("finalizes after resolve and remains a single row", async () => {
    const { incident, target, owner } =
      await openAircoIncident("Impact Resolve");
    const resolvedAt = zonedLocalToUtc("Europe/Amsterdam", 2026, 8, 30, 15, 45);
    await persistAndProcessCheck({
      monitorId: target.monitorId!,
      organizationId: owner.organization.id,
      websiteId: target.websiteId!,
      startedAt: resolvedAt,
      finishedAt: resolvedAt,
      result: {
        ...failure,
        status: "SUCCESS",
        httpStatus: 200,
        errorType: null,
        errorMessage: null,
      },
    });
    const updated = await database.incident.findUniqueOrThrow({
      where: { id: incident.id },
    });
    expect(updated.status).toBe("RESOLVED");
    const impacts = await database.googleAdsIncidentImpact.findMany({
      where: { incidentId: incident.id },
    });
    expect(impacts).toHaveLength(1);
    expect(impacts[0]?.windowEndedAt?.toISOString()).toBe(
      resolvedAt.toISOString(),
    );
    expect(impacts[0]?.windowCostMicros).toBe(135_000_000n);
    expect(impacts[0]?.windowClicksEstimated).toBe(true);
  });

  it("is idempotent for a second refresh", async () => {
    const { incident } = await openAircoIncident("Impact Idempotent");
    await executeGoogleAdsImpactJob({
      incidentId: incident.id,
      reason: "refresh",
    });
    await executeGoogleAdsImpactJob({
      incidentId: incident.id,
      reason: "refresh",
    });
    expect(
      await database.googleAdsIncidentImpact.count({
        where: { incidentId: incident.id },
      }),
    ).toBe(1);
  });

  it("blocks tenant B from refreshing tenant A", async () => {
    const { owner, incident } = await openAircoIncident("Impact Tenant A");
    const other = await connectOwner("Impact Tenant B");
    await expect(
      enqueueManualGoogleAdsImpact({
        userId: other.user.id,
        organizationSlug: other.organization.slug,
        incidentId: incident.id,
      }),
    ).rejects.toBeInstanceOf(DomainError);
    await expect(
      enqueueManualGoogleAdsImpact({
        userId: other.user.id,
        organizationSlug: owner.organization.slug,
        incidentId: incident.id,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("keeps stored impact after disconnect", async () => {
    const { owner, incident } = await openAircoIncident("Impact Disconnect");
    await disconnectGoogleAds({
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
    });
    const impact = await database.googleAdsIncidentImpact.findUniqueOrThrow({
      where: { incidentId: incident.id },
    });
    expect(impact.windowCostMicros).toBe(165_000_000n);
    expect(impact.dataIncomplete).toBe(true);
  });

  it("blocks MEMBER from refreshing impact", async () => {
    const { owner, incident } = await openAircoIncident("Impact Member");
    const member = await createTestUser("Impact Member User");
    userIds.push(member.id);
    await database.organizationMember.create({
      data: {
        userId: member.id,
        organizationId: owner.organization.id,
        role: "MEMBER",
      },
    });
    await expect(
      enqueueManualGoogleAdsImpact({
        userId: member.id,
        organizationSlug: owner.organization.slug,
        incidentId: incident.id,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});
