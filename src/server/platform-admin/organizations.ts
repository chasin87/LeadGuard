import { DomainError } from "@/server/authorization/errors";
import { database } from "@/server/database";
import type { PlatformActor } from "@/server/platform-admin/access";
import { recordPlatformAudit } from "@/server/platform-admin/audit";
import {
  boundReason,
  isManualSuspensionReason,
} from "@/server/platform-admin/constants";
import { assertPlatformActor } from "@/server/platform-admin/guard";

export async function suspendOrganization(input: {
  organizationId: string;
  reasonCode: string;
  details: string;
  actor: PlatformActor;
}) {
  assertPlatformActor(input.actor, "platform:organizations:manage");
  if (!isManualSuspensionReason(input.reasonCode)) {
    throw new DomainError("Choose a valid suspension reason.");
  }
  const details = boundReason(input.details);
  const organization = await database.organization.findUnique({
    where: { id: input.organizationId },
  });
  if (!organization) throw new DomainError("Organization was not found.");
  const reason = details ? `${input.reasonCode}: ${details}` : input.reasonCode;
  await database.organization.update({
    where: { id: organization.id },
    data: {
      manualSuspendedAt: new Date(),
      manualSuspensionReason: reason,
      manualSuspendedByUserId: input.actor.userId,
    },
  });
  await recordPlatformAudit({
    actor: input.actor,
    action: "ORGANIZATION_SUSPENDED",
    targetType: "Organization",
    targetId: organization.id,
    organizationId: organization.id,
    reason,
    metadata: { reasonCode: input.reasonCode, name: organization.name },
  });
}

export async function reactivateOrganization(input: {
  organizationId: string;
  reason: string;
  actor: PlatformActor;
}) {
  assertPlatformActor(input.actor, "platform:organizations:manage");
  const reason = boundReason(input.reason);
  if (reason.length < 3) throw new DomainError("A reason is required.");
  const organization = await database.organization.findUnique({
    where: { id: input.organizationId },
  });
  if (!organization) throw new DomainError("Organization was not found.");
  await database.organization.update({
    where: { id: organization.id },
    data: {
      manualSuspendedAt: null,
      manualSuspensionReason: null,
      manualSuspendedByUserId: null,
    },
  });
  await recordPlatformAudit({
    actor: input.actor,
    action: "ORGANIZATION_REACTIVATED",
    targetType: "Organization",
    targetId: organization.id,
    organizationId: organization.id,
    reason,
    metadata: { name: organization.name },
  });
}
