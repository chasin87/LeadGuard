import { DomainError } from "@/server/authorization/errors";
import { consumeRateLimit } from "@/server/auth/rate-limit";
import { reconcileOrganizationBilling } from "@/server/billing/projection";
import { database } from "@/server/database";
import type { PlatformActor } from "@/server/platform-admin/access";
import { recordPlatformAudit } from "@/server/platform-admin/audit";
import { boundReason } from "@/server/platform-admin/constants";
import { assertPlatformActor } from "@/server/platform-admin/guard";

export async function triggerBillingReconciliation(input: {
  organizationId: string;
  actor: PlatformActor;
  reason: string;
}) {
  assertPlatformActor(input.actor, "platform:billing:manage");
  const reason = boundReason(input.reason);
  if (reason.length < 3) throw new DomainError("A reason is required.");
  const limit = consumeRateLimit(
    `platform-billing-reconcile:${input.organizationId}`,
    1,
    60_000,
  );
  if (!limit.ok) {
    throw new DomainError("Billing reconciliation is cooling down.");
  }
  const organization = await database.organization.findUnique({
    where: { id: input.organizationId },
    select: { id: true },
  });
  if (!organization) throw new DomainError("Organization was not found.");
  await reconcileOrganizationBilling(organization.id);
  await recordPlatformAudit({
    actor: input.actor,
    action: "BILLING_RECONCILIATION_TRIGGERED",
    targetType: "Organization",
    targetId: organization.id,
    organizationId: organization.id,
    reason,
  });
}
