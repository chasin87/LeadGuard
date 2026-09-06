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
  const headerEventId = request.headers.get("x-leadguard-event-id");
  if (
    headerEventId &&
    read.payload &&
    typeof read.payload === "object" &&
    String((read.payload as { eventId?: unknown }).eventId ?? "") !==
      headerEventId
  ) {
    return Response.json(
      { error: "eventId header does not match body." },
      { status: 400 },
    );
  }
  const result = await ingestOutcomePayload({
    integration: read.integration,
    payload: read.payload,
    persist: true,
  });
  return Response.json(publicResult(result), {
    headers: { "Cache-Control": "no-store" },
  });
}
