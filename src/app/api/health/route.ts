import { database } from "@/server/database";
import { createLogger } from "@/server/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const logger = createLogger("health");

export async function GET() {
  const checkedAt = new Date().toISOString();
  try {
    await database.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok", checks: { database: "ok" }, checkedAt });
  } catch {
    logger.error("Database health check failed");
    return Response.json({ status: "unhealthy", checks: { database: "unhealthy" }, checkedAt }, { status: 503 });
  }
}
