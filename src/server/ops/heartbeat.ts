import type { WorkerHeartbeatType } from "@/generated/prisma/enums";
import { database } from "@/server/database";

const instanceId =
  process.env.HOSTNAME?.trim() ||
  process.env.WORKER_INSTANCE_ID?.trim() ||
  `pid-${process.pid}`;

const version =
  process.env.GIT_COMMIT_SHA?.trim() ||
  process.env.APP_VERSION?.trim() ||
  process.env.npm_package_version ||
  null;

export async function recordWorkerHeartbeat(
  workerType: WorkerHeartbeatType,
  metadata?: string,
) {
  const now = new Date();
  await database.workerHeartbeat.upsert({
    where: {
      workerType_instanceId: { workerType, instanceId },
    },
    create: {
      workerType,
      instanceId,
      lastSeenAt: now,
      version,
      metadata: metadata?.slice(0, 500) ?? null,
    },
    update: {
      lastSeenAt: now,
      version,
      metadata: metadata?.slice(0, 500) ?? undefined,
    },
  });
}

export async function listStaleWorkerHeartbeats(staleAfterMs = 5 * 60 * 1000) {
  const cutoff = new Date(Date.now() - staleAfterMs);
  return database.workerHeartbeat.findMany({
    where: { lastSeenAt: { lt: cutoff } },
    orderBy: { lastSeenAt: "asc" },
  });
}

export function applicationVersion() {
  return version;
}
