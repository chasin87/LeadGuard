import { database } from "@/server/database";
import { createLogger } from "@/server/logger";
import { applicationVersion } from "@/server/ops/heartbeat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const logger = createLogger("ready");

export async function GET() {
  const checkedAt = new Date().toISOString();
  try {
    await database.$queryRaw`SELECT 1`;
    return Response.json({
      status: "ready",
      checks: { database: "ok" },
      version: applicationVersion(),
      checkedAt,
    });
  } catch {
    logger.error("Readiness check failed");
    return Response.json(
      {
        status: "not_ready",
        checks: { database: "unhealthy" },
        version: applicationVersion(),
        checkedAt,
      },
      { status: 503 },
    );
  }
}
