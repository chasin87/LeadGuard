import { NextRequest } from "next/server";
import {
  ingestOutcomePayload,
  publicResult,
  readOutcomeRequest,
} from "@/server/outcomes/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const read = await readOutcomeRequest(request);
  if (!read.ok) return read.response;
  const result = await ingestOutcomePayload({
    integration: read.integration,
    payload: read.payload,
    persist: false,
  });
  return Response.json(publicResult(result), {
    headers: { "Cache-Control": "no-store" },
  });
}
