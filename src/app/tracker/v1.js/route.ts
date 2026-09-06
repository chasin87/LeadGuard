import { trackerV1Source } from "@/tracking/sdk/v1-source";

export const runtime = "nodejs";

export function GET() {
  return new Response(trackerV1Source, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
