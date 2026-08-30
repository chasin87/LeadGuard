import http from "node:http";
import https from "node:https";
import type { LookupAddress } from "node:dns";

export type PinnedHttpRequest = {
  url: URL;
  ip: string;
  headers: Record<string, string>;
  timeoutMs: number;
  maxBodyBytes: number;
  method?: "GET" | "POST";
  body?: string;
  signal?: AbortSignal;
};

export type PinnedHttpResponse = {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body?: Buffer;
  bodyTruncated?: boolean;
};

export type PinnedHttpTransport = (
  request: PinnedHttpRequest,
) => Promise<PinnedHttpResponse>;

export function ipFamily(ip: string): 4 | 6 {
  return ip.includes(":") ? 6 : 4;
}

/** Always returns the already-validated address so the client cannot re-resolve. */
export function createPinnedLookup(ip: string) {
  const family = ipFamily(ip);
  return (
    _hostname: string,
    _options: unknown,
    callback: (
      err: NodeJS.ErrnoException | null,
      address: string | LookupAddress[],
      family?: number,
    ) => void,
  ) => {
    callback(null, ip, family);
  };
}

export function buildPinnedRequestOptions(
  request: PinnedHttpRequest,
): https.RequestOptions {
  const { url, ip, headers } = request;
  const tls = url.protocol === "https:";
  const port = url.port ? Number(url.port) : tls ? 443 : 80;
  const body = request.body;
  return {
    protocol: url.protocol,
    hostname: ip,
    port,
    path: `${url.pathname}${url.search}`,
    method: request.method ?? "GET",
    headers: {
      ...headers,
      Host: url.host,
      ...(body !== undefined
        ? { "Content-Length": String(Buffer.byteLength(body)) }
        : {}),
    },
    servername: tls ? url.hostname : undefined,
    lookup: createPinnedLookup(ip),
    family: ipFamily(ip),
    rejectUnauthorized: tls ? true : undefined,
  };
}

function isRedirectStatus(status: number): boolean {
  return (
    status === 301 ||
    status === 302 ||
    status === 303 ||
    status === 307 ||
    status === 308
  );
}

function collectBoundedBody(
  response: http.IncomingMessage,
  request: http.ClientRequest,
  maxBodyBytes: number,
  store: boolean,
): Promise<{ body: Buffer; truncated: boolean }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let received = 0;
    let truncated = false;
    let finished = false;

    const done = () => {
      if (finished) return;
      finished = true;
      resolve({
        body: store ? Buffer.concat(chunks) : Buffer.alloc(0),
        truncated,
      });
    };

    response.on("data", (chunk: Buffer) => {
      if (truncated) return;
      const remaining = maxBodyBytes - received;
      if (remaining <= 0) {
        truncated = true;
        response.destroy();
        request.destroy();
        done();
        return;
      }
      if (chunk.length > remaining) {
        if (store) chunks.push(chunk.subarray(0, remaining));
        received = maxBodyBytes;
        truncated = true;
        response.destroy();
        request.destroy();
        done();
        return;
      }
      if (store) chunks.push(chunk);
      received += chunk.length;
    });
    response.on("end", done);
    response.on("close", done);
    response.on("error", done);
  });
}

export function defaultPinnedTransport(
  request: PinnedHttpRequest,
): Promise<PinnedHttpResponse> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeoutError = (code: NodeJS.ErrnoException["code"]) => {
      const error = new Error("The request timed out.");
      (error as NodeJS.ErrnoException).code = code;
      return error;
    };
    const settle = (action: () => void) => {
      if (settled) return;
      settled = true;
      request.signal?.removeEventListener("abort", onAbort);
      action();
    };
    const options = buildPinnedRequestOptions(request);
    const client = request.url.protocol === "https:" ? https : http;
    const sockets: { request?: http.ClientRequest } = {};
    const onAbort = () => {
      sockets.request?.destroy();
      settle(() => reject(timeoutError("ABORT_ERR")));
    };

    if (request.signal?.aborted) {
      reject(timeoutError("ABORT_ERR"));
      return;
    }

    const req = client.request(options, (response) => {
      const statusCode = response.statusCode ?? 0;
      const storeBody = !isRedirectStatus(statusCode);
      void collectBoundedBody(
        response,
        req,
        request.maxBodyBytes,
        storeBody,
      ).then(({ body, truncated }) => {
        settle(() =>
          resolve({
            statusCode,
            headers: response.headers,
            body,
            bodyTruncated: truncated,
          }),
        );
      });
    });
    sockets.request = req;

    req.setTimeout(request.timeoutMs, () => {
      req.destroy();
      settle(() => reject(timeoutError("ETIMEDOUT")));
    });
    request.signal?.addEventListener("abort", onAbort, { once: true });
    req.on("error", (error) => {
      settle(() => reject(error));
    });
    req.end(request.body);
  });
}
