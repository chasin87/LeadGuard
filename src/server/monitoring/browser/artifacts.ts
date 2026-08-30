import { getBrowserMonitoringConfig } from "@/server/monitoring/browser/config";
import { database } from "@/server/database";
import { createLogger } from "@/server/logger";
import { getArtifactStorage } from "@/server/storage";

const logger = createLogger("browser-worker");

export function screenshotStorageKey(
  organizationId: string,
  checkId: string,
): string {
  return `screenshots/${organizationId}/${checkId}.jpg`;
}

export async function storeCheckScreenshot(input: {
  organizationId: string;
  checkId: string;
  body: Buffer;
}): Promise<string | null> {
  const key = screenshotStorageKey(input.organizationId, input.checkId);
  try {
    await getArtifactStorage().put(key, input.body, "image/jpeg");
    await database.browserCheckDetail.updateMany({
      where: { checkId: input.checkId },
      data: {
        screenshotKey: key,
        screenshotCapturedAt: new Date(),
      },
    });
    await database.formCheckDetail.updateMany({
      where: { checkId: input.checkId },
      data: {
        screenshotKey: key,
        screenshotCapturedAt: new Date(),
      },
    });
    return key;
  } catch (error) {
    logger.error("browser.screenshot.storage_failed", {
      organizationId: input.organizationId,
      checkId: input.checkId,
      message: error instanceof Error ? error.message : "unknown",
    });
    return null;
  }
}

export async function cleanupExpiredScreenshots(
  now = new Date(),
): Promise<number> {
  const days = getBrowserMonitoringConfig().artifactRetentionDays;
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const expiredBrowser = await database.browserCheckDetail.findMany({
    where: {
      screenshotKey: { not: null },
      screenshotCapturedAt: { lt: cutoff },
    },
    select: { id: true, screenshotKey: true },
    take: 200,
  });
  const expiredForm = await database.formCheckDetail.findMany({
    where: {
      screenshotKey: { not: null },
      screenshotCapturedAt: { lt: cutoff },
    },
    select: { id: true, screenshotKey: true },
    take: 200,
  });
  const storage = getArtifactStorage();
  let removed = 0;
  for (const row of expiredBrowser) {
    if (!row.screenshotKey) continue;
    try {
      await storage.delete(row.screenshotKey);
    } catch (error) {
      logger.warn("browser.screenshot.cleanup_failed", {
        message: error instanceof Error ? error.message : "unknown",
      });
      continue;
    }
    await database.browserCheckDetail.update({
      where: { id: row.id },
      data: { screenshotKey: null, screenshotCapturedAt: null },
    });
    removed += 1;
  }
  for (const row of expiredForm) {
    if (!row.screenshotKey) continue;
    try {
      await storage.delete(row.screenshotKey);
    } catch (error) {
      logger.warn("form.screenshot.cleanup_failed", {
        message: error instanceof Error ? error.message : "unknown",
      });
      continue;
    }
    await database.formCheckDetail.update({
      where: { id: row.id },
      data: { screenshotKey: null, screenshotCapturedAt: null },
    });
    removed += 1;
  }
  if (removed > 0) {
    logger.info("browser.screenshot.cleanup", { removed });
  }
  return removed;
}
