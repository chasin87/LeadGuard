import { NextRequest } from "next/server";
import { getOutcomeIngestionConfig } from "@/server/outcomes/config";
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
  const config = getOutcomeIngestionConfig();
  const body = read.payload;
  const events =
    body &&
    typeof body === "object" &&
    Array.isArray((body as { events?: unknown }).events)
      ? (body as { events: unknown[] }).events
      : Array.isArray(body)
        ? body
        : null;
  if (!events) {
    return Response.json(
      { error: "Body must be an array or { events: [] }." },
      { status: 400 },
    );
  }
  if (events.length === 0 || events.length > config.maxBatchEvents) {
    return Response.json(
      { error: `Batch must contain 1–${config.maxBatchEvents} events.` },
      { status: 400 },
    );
  }
  const results = [];
  for (const event of events) {
    results.push(
      publicResult(
        await ingestOutcomePayload({
          integration: read.integration,
          payload: event,
          persist: true,
        }),
      ),
    );
  }
  return Response.json(
    { results },
    { headers: { "Cache-Control": "no-store" } },
  );
}
