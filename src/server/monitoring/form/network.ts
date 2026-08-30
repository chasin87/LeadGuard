import type { Page, Request, Response } from "playwright-core";
import { sanitizeResourceUrl } from "@/server/monitoring/browser/sanitize";

export type ObservedFormRequest = {
  method: string;
  path: string;
  status: number | null;
  resourceType: string;
  startedAt: number;
  sameOrigin: boolean;
};

const relevantTypes = new Set(["document", "xhr", "fetch"]);
const relevantMethods = new Set(["POST", "PUT", "PATCH"]);

export function attachFormNetworkObserver(
  page: Page,
  pageOrigin: string,
): { requests: ObservedFormRequest[]; dispose: () => void } {
  const requests: ObservedFormRequest[] = [];
  const started = new Map<Request, ObservedFormRequest>();

  const onRequest = (request: Request) => {
    const type = request.resourceType();
    if (!relevantTypes.has(type)) return;
    let parsed: URL;
    try {
      parsed = new URL(request.url());
    } catch {
      return;
    }
    const record: ObservedFormRequest = {
      method: request.method().toUpperCase(),
      path: sanitizeResourceUrl(request.url()),
      status: null,
      resourceType: type,
      startedAt: Date.now(),
      sameOrigin: parsed.origin === pageOrigin,
    };
    started.set(request, record);
    requests.push(record);
  };
  const onResponse = (response: Response) => {
    const record = started.get(response.request());
    if (record) record.status = response.status();
  };

  page.on("request", onRequest);
  page.on("response", onResponse);
  return {
    requests,
    dispose: () => {
      page.off("request", onRequest);
      page.off("response", onResponse);
    },
  };
}

export function selectSubmitRequest(
  requests: ObservedFormRequest[],
  clickedAt: number,
): ObservedFormRequest | null {
  const after = requests.filter(
    (item) =>
      item.startedAt >= clickedAt - 50 && relevantMethods.has(item.method),
  );
  if (after.length === 0) return null;
  const serverError = after.find(
    (item) => item.status != null && item.status >= 500,
  );
  if (serverError) return serverError;
  const sameOrigin = after.find((item) => item.sameOrigin);
  return sameOrigin ?? after[0] ?? null;
}
