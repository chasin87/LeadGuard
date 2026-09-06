import { database } from "@/server/database";

export type QueueBacklogSnapshot = {
  pending: number;
  oldestAgeMs: number | null;
  failed: number;
};

export async function getQueueBacklogSnapshot(): Promise<QueueBacklogSnapshot> {
  try {
    const [pending, failed, oldest] = await Promise.all([
      database.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count
        FROM pgboss.job
        WHERE state = 'created'
      `.catch(() => [{ count: 0n }]),
      database.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count
        FROM pgboss.job
        WHERE state = 'failed'
      `.catch(() => [{ count: 0n }]),
      database.$queryRaw<Array<{ createdon: Date | null }>>`
        SELECT MIN(created_on) AS createdon
        FROM pgboss.job
        WHERE state = 'created'
      `.catch(() => [{ createdon: null }]),
    ]);
    const oldestAt = oldest[0]?.createdon ?? null;
    return {
      pending: Number(pending[0]?.count ?? 0),
      failed: Number(failed[0]?.count ?? 0),
      oldestAgeMs: oldestAt ? Date.now() - oldestAt.getTime() : null,
    };
  } catch {
    return { pending: 0, failed: 0, oldestAgeMs: null };
  }
}
