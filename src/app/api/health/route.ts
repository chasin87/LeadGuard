import { createLogger } from "@/server/logger";
import { applicationVersion } from "@/server/ops/heartbeat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const logger = createLogger("health");

export async function GET() {
  const checkedAt = new Date().toISOString();
  try {
    const { database } = await import("@/server/database");
    await database.$queryRaw`SELECT 1`;
    return Response.json({
      status: "ok",
      checks: { database: "ok" },
      version: applicationVersion(),
      checkedAt,
    });
  } catch {
    logger.error("Database health check failed");
    return Response.json(
      { status: "unhealthy", checks: { database: "unhealthy" }, checkedAt },
      { status: 503 },
    );
  }
}
