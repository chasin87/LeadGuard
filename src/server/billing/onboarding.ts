import { database } from "@/server/database";

export type OnboardingStepKey =
  "website" | "monitor" | "notification" | "firstCheck";

export type OrganizationOnboardingState = {
  websiteCompletedAt: Date | null;
  monitorCompletedAt: Date | null;
  notificationCompletedAt: Date | null;
  firstCheckCompletedAt: Date | null;
  completedAt: Date | null;
  dismissedAt: Date | null;
  activated: boolean;
  nextStep: OnboardingStepKey | null;
};

export async function getOrganizationOnboarding(
  organizationId: string,
): Promise<OrganizationOnboardingState> {
  const [website, monitor, notification, firstCheck, stored] =
    await Promise.all([
      database.website.findFirst({
        where: { organizationId, status: "ACTIVE" },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      }),
      database.monitor.findFirst({
        where: { deletedAt: null, website: { organizationId } },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      }),
      database.notificationChannel.findFirst({
        where: { organizationId, deletedAt: null },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      }),
      database.monitorCheck.findFirst({
        where: {
          status: "SUCCESS",
          monitor: { website: { organizationId } },
        },
        orderBy: { finishedAt: "asc" },
        select: { finishedAt: true },
      }),
      database.organizationOnboarding.findUnique({
        where: { organizationId },
      }),
    ]);

  const websiteCompletedAt =
    website?.createdAt ?? stored?.websiteCompletedAt ?? null;
  const monitorCompletedAt =
    monitor?.createdAt ?? stored?.monitorCompletedAt ?? null;
  const notificationCompletedAt =
    notification?.createdAt ?? stored?.notificationCompletedAt ?? null;
  const firstCheckCompletedAt =
    firstCheck?.finishedAt ?? stored?.firstCheckCompletedAt ?? null;
  const activated = Boolean(
    websiteCompletedAt &&
    monitorCompletedAt &&
    notificationCompletedAt &&
    firstCheckCompletedAt,
  );
  const completedAt =
    stored?.completedAt ??
    (activated
      ? ([
          websiteCompletedAt,
          monitorCompletedAt,
          notificationCompletedAt,
          firstCheckCompletedAt,
        ].sort((left, right) => left!.getTime() - right!.getTime())[3] ??
        new Date())
      : null);

  await database.organizationOnboarding.upsert({
    where: { organizationId },
    create: {
      organizationId,
      websiteCompletedAt,
      monitorCompletedAt,
      notificationCompletedAt,
      firstCheckCompletedAt,
      completedAt,
      dismissedAt: stored?.dismissedAt ?? null,
    },
    update: {
      websiteCompletedAt,
      monitorCompletedAt,
      notificationCompletedAt,
      firstCheckCompletedAt,
      completedAt,
    },
  });

  const nextStep: OnboardingStepKey | null = !websiteCompletedAt
    ? "website"
    : !monitorCompletedAt
      ? "monitor"
      : !notificationCompletedAt
        ? "notification"
        : !firstCheckCompletedAt
          ? "firstCheck"
          : null;

  return {
    websiteCompletedAt,
    monitorCompletedAt,
    notificationCompletedAt,
    firstCheckCompletedAt,
    completedAt,
    dismissedAt: stored?.dismissedAt ?? null,
    activated,
    nextStep,
  };
}

export async function dismissOrganizationOnboarding(organizationId: string) {
  await database.organizationOnboarding.upsert({
    where: { organizationId },
    create: {
      organizationId,
      dismissedAt: new Date(),
    },
    update: { dismissedAt: new Date() },
  });
}
