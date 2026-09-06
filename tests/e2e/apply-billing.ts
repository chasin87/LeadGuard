import { config } from "dotenv";
import { database } from "@/server/database";
import type {
  BillingPlanKey,
  BillingSubscriptionStatus,
} from "@/generated/prisma/enums";

if (!process.env.DATABASE_URL) {
  config({ path: process.env.E2E_ENV_FILE ?? ".env" });
}

async function main() {
  const organizationSlug = process.argv[2];
  const scenario = process.argv[3];
  if (!organizationSlug || !scenario) {
    throw new Error(
      "Usage: apply-billing.ts <organizationSlug> <past_due|suspended|recover|starter|cancel_at_period_end>",
    );
  }
  const organization = await database.organization.findUnique({
    where: { slug: organizationSlug },
  });
  if (!organization) throw new Error("Organization not found.");
  const now = new Date();
  const patch: {
    status?: BillingSubscriptionStatus;
    planKey?: BillingPlanKey;
    graceDeadlineAt?: Date | null;
    cancelAtPeriodEnd?: boolean;
    currentPeriodEnd?: Date;
  } = {};
  if (scenario === "past_due") {
    patch.status = "PAST_DUE";
    patch.graceDeadlineAt = new Date(now.getTime() + 2 * 86_400_000);
  } else if (scenario === "suspended") {
    patch.status = "SUSPENDED";
    patch.graceDeadlineAt = new Date(now.getTime() - 86_400_000);
  } else if (scenario === "recover") {
    patch.status = "ACTIVE";
    patch.graceDeadlineAt = null;
  } else if (scenario === "starter") {
    patch.planKey = "STARTER";
    patch.status = "ACTIVE";
  } else if (scenario === "cancel_at_period_end") {
    patch.cancelAtPeriodEnd = true;
    patch.currentPeriodEnd = new Date(now.getTime() + 5 * 86_400_000);
    patch.status = "ACTIVE";
  } else {
    throw new Error(`Unknown scenario ${scenario}`);
  }
  await database.billingSubscription.update({
    where: { organizationId: organization.id },
    data: patch,
  });
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(async () => {
    await database.$disconnect();
  });
