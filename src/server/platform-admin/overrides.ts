import { DomainError } from "@/server/authorization/errors";
import { isFeatureKey, isLimitKey } from "@/server/billing/entitlements";
import { database } from "@/server/database";
import type { PlatformActor } from "@/server/platform-admin/access";
import { recordPlatformAudit } from "@/server/platform-admin/audit";
import { boundReason } from "@/server/platform-admin/constants";
import { assertPlatformActor } from "@/server/platform-admin/guard";

export async function createEntitlementOverride(input: {
  organizationId: string;
  featureKey?: string;
  limitKey?: string;
  booleanValue?: boolean;
  integerValue?: number;
  expiresAt?: Date | null;
  reason: string;
  actor: PlatformActor;
}) {
  assertPlatformActor(input.actor, "platform:billing:manage");
  const reason = boundReason(input.reason);
  if (reason.length < 3) throw new DomainError("A reason is required.");
  const hasFeature = Boolean(input.featureKey);
  const hasLimit = Boolean(input.limitKey);
  if (hasFeature === hasLimit) {
    throw new DomainError("Set exactly one feature or limit key.");
  }
  if (input.featureKey && !isFeatureKey(input.featureKey)) {
    throw new DomainError("Unknown feature key.");
  }
  if (input.limitKey && !isLimitKey(input.limitKey)) {
    throw new DomainError("Unknown limit key.");
  }
  if (
    input.limitKey &&
    (input.integerValue == null || input.integerValue < 0)
  ) {
    throw new DomainError("Limit overrides need a non-negative integer.");
  }
  if (input.featureKey && input.booleanValue == null) {
    throw new DomainError("Feature overrides need a boolean value.");
  }
  const created = await database.organizationEntitlementOverride.create({
    data: {
      organizationId: input.organizationId,
      featureKey: input.featureKey ?? null,
      limitKey: input.limitKey ?? null,
      booleanValue: input.featureKey ? (input.booleanValue ?? null) : null,
      integerValue: input.limitKey ? (input.integerValue ?? null) : null,
      reason,
      expiresAt: input.expiresAt ?? null,
      createdByUserId: input.actor.userId,
    },
  });
  await recordPlatformAudit({
    actor: input.actor,
    action: "ENTITLEMENT_OVERRIDE_CREATED",
    targetType: "OrganizationEntitlementOverride",
    targetId: created.id,
    organizationId: input.organizationId,
    reason,
    metadata: {
      featureKey: created.featureKey,
      limitKey: created.limitKey,
      integerValue: created.integerValue,
      booleanValue: created.booleanValue,
      expiresAt: created.expiresAt?.toISOString() ?? null,
    },
  });
  return created;
}

export async function removeEntitlementOverride(input: {
  overrideId: string;
  reason: string;
  actor: PlatformActor;
}) {
  assertPlatformActor(input.actor, "platform:billing:manage");
  const reason = boundReason(input.reason);
  if (reason.length < 3) throw new DomainError("A reason is required.");
  const existing = await database.organizationEntitlementOverride.findUnique({
    where: { id: input.overrideId },
  });
  if (!existing) throw new DomainError("Override was not found.");
  await database.organizationEntitlementOverride.delete({
    where: { id: existing.id },
  });
  await recordPlatformAudit({
    actor: input.actor,
    action: "ENTITLEMENT_OVERRIDE_REMOVED",
    targetType: "OrganizationEntitlementOverride",
    targetId: existing.id,
    organizationId: existing.organizationId,
    reason,
    metadata: {
      featureKey: existing.featureKey,
      limitKey: existing.limitKey,
      integerValue: existing.integerValue,
      booleanValue: existing.booleanValue,
    },
  });
}
