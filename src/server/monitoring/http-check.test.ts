import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { performHttpMonitorCheck } from "./http-check";
import type { PinnedHttpTransport } from "./pinned-transport";
import {
  buildPinnedRequestOptions,
  createPinnedLookup,
  defaultPinnedTransport,
} from "./pinned-transport";

const publicIp = "93.184.216.34";

function resolverOf(map: Record<string, string[]>) {
  return async (hostname: string) => map[hostname] ?? [publicIp];
}

function htmlTransport(
  script: Array<{
    status: number;
    location?: string;
    ip?: string;
    body?: string;
    contentType?: string;
    encoding?: string;
  }>,
): PinnedHttpTransport {
  let index = 0;
  return async (request) => {
    const step = script[index];
    if (!step) {
      throw new Error("Unexpected extra HTTP request");
    }
    index += 1;
    if (step.ip) {
      expect(request.ip).toBe(step.ip);
    }
    const headers: Record<string, string> = {};
    if (step.location) headers.location = step.location;
    if (step.contentType) headers["content-type"] = step.contentType;
    if (step.encoding) headers["content-encoding"] = step.encoding;
    return {
      statusCode: step.status,
      headers,
      body: step.body ? Buffer.from(step.body) : undefined,
    };
  };
}

describe("performHttpMonitorCheck", () => {
  it("records success, 404 and 500 without following extra hops", async () => {
    const resolver = resolverOf({ "example.com": [publicIp] });
    await expect(
      performHttpMonitorCheck("https://example.com/ok", {
        resolver,
        transport: htmlTransport([{ status: 200, ip: publicIp }]),
      }),
    ).resolves.toMatchObject({ status: "SUCCESS", httpStatus: 200 });

    await expect(
      performHttpMonitorCheck("https://example.com/missing", {
        resolver,
        transport: htmlTransport([{ status: 404, ip: publicIp }]),
      }),
    ).resolves.toMatchObject({
      status: "FAILURE",
      errorType: "HTTP_404",
      httpStatus: 404,
    });

    await expect(
      performHttpMonitorCheck("https://example.com/boom", {
        resolver,
        transport: htmlTransport([{ status: 500, ip: publicIp }]),
      }),
    ).resolves.toMatchObject({ status: "FAILURE", errorType: "HTTP_5XX" });
  });

  it("follows a relative redirect and records redirect count", async () => {
    const result = await performHttpMonitorCheck("https://example.com/start", {
      resolver: resolverOf({ "example.com": [publicIp] }),
      transport: htmlTransport([
        { status: 302, location: "/done" },
        { status: 200 },
      ]),
    });
    expect(result.status).toBe("SUCCESS");
    expect(result.redirectCount).toBe(1);
    expect(result.finalUrl).toBe("https://example.com/done");
  });

  it("detects redirect loops before hitting max redirects", async () => {
    const result = await performHttpMonitorCheck("https://example.com/a", {
      resolver: resolverOf({ "example.com": [publicIp] }),
      transport: htmlTransport([
        { status: 302, location: "/b" },
        { status: 302, location: "/a" },
      ]),
    });
    expect(result.errorType).toBe("REDIRECT_LOOP");
  });

  it("stops after too many redirects", async () => {
    const result = await performHttpMonitorCheck("https://example.com/r", {
      resolver: resolverOf({ "example.com": [publicIp] }),
      maxRedirects: 2,
      transport: htmlTransport([
        { status: 302, location: "/1" },
        { status: 302, location: "/2" },
        { status: 302, location: "/3" },
      ]),
    });
    expect(result.errorType).toBe("TOO_MANY_REDIRECTS");
  });

  it("blocks unsafe redirects without calling the next hop", async () => {
    let requests = 0;
    const result = await performHttpMonitorCheck("https://example.com/go", {
      resolver: resolverOf({ "example.com": [publicIp] }),
      transport: async (request) => {
        requests += 1;
        expect(request.url.hostname).toBe("example.com");
        return {
          statusCode: 302,
          headers: { location: "http://127.0.0.1/admin" },
        };
      },
    });
    expect(requests).toBe(1);
    expect(result.errorType).toBe("UNSAFE_REDIRECT");
  });

  it("blocks a redirect to cloud metadata", async () => {
    const result = await performHttpMonitorCheck("https://example.com/meta", {
      resolver: resolverOf({ "example.com": [publicIp] }),
      transport: htmlTransport([
        { status: 302, location: "http://169.254.169.254/latest/meta-data" },
      ]),
    });
    expect(result.errorType).toBe("UNSAFE_REDIRECT");
  });

  it("does not connect when DNS resolves to a private address", async () => {
    let called = 0;
    const result = await performHttpMonitorCheck("https://evil.example.com", {
      resolver: async () => ["10.0.0.1"],
      transport: async () => {
        called += 1;
        return { statusCode: 200, headers: {} };
      },
    });
    expect(called).toBe(0);
    expect(result.errorType).toBe("UNSAFE_TARGET");
  });

  it("pins the first validated IP so a later DNS answer cannot be used", async () => {
    let lookups = 0;
    const result = await performHttpMonitorCheck("https://rebind.example.com", {
      resolver: async () => {
        lookups += 1;
        return lookups === 1 ? [publicIp] : ["127.0.0.1"];
      },
      transport: htmlTransport([{ status: 200, ip: publicIp }]),
    });
    expect(lookups).toBe(1);
    expect(result.status).toBe("SUCCESS");
    expect(result.resolvedIp).toBe(publicIp);
  });

  it("maps timeouts and connection failures", async () => {
    const timeout = await performHttpMonitorCheck("https://example.com/slow", {
      resolver: resolverOf({ "example.com": [publicIp] }),
      timeoutMs: 30,
      transport: async (request) =>
        new Promise((_, reject) => {
          request.signal?.addEventListener("abort", () => {
            const error = new Error("aborted");
            (error as NodeJS.ErrnoException).code = "ABORT_ERR";
            reject(error);
          });
        }),
    });
    expect(timeout.errorType).toBe("TIMEOUT");

    const refused = await performHttpMonitorCheck("https://example.com/down", {
      resolver: resolverOf({ "example.com": [publicIp] }),
      transport: async () => {
        const error = new Error("connect ECONNREFUSED");
        (error as NodeJS.ErrnoException).code = "ECONNREFUSED";
        throw error;
      },
    });
    expect(refused.errorType).toBe("CONNECTION_ERROR");
  });

  it("marks HTTP 200 not-found HTML as SOFT_404 and keeps HTTP 404 as HTTP_404", async () => {
    const html =
      "<title>404 - Page not found</title><h1>Page not found</h1><p>Sorry, the page you are looking for does not exist.</p>";
    const soft = await performHttpMonitorCheck("https://example.com/ad", {
      resolver: resolverOf({ "example.com": [publicIp] }),
      transport: htmlTransport([
        { status: 200, body: html, contentType: "text/html" },
      ]),
    });
    expect(soft).toMatchObject({
      status: "FAILURE",
      errorType: "SOFT_404",
      httpStatus: 200,
    });
    expect(soft.soft404Score).toBeGreaterThanOrEqual(80);

    const hard = await performHttpMonitorCheck("https://example.com/missing", {
      resolver: resolverOf({ "example.com": [publicIp] }),
      transport: htmlTransport([
        { status: 404, body: html, contentType: "text/html" },
      ]),
    });
    expect(hard.errorType).toBe("HTTP_404");
  });

  it("does not classify a normal homepage or JSON as soft-404", async () => {
    const home = await performHttpMonitorCheck("https://example.com/", {
      resolver: resolverOf({ "example.com": [publicIp] }),
      transport: htmlTransport([
        {
          status: 200,
          contentType: "text/html",
          body: "<title>Acme</title><h1>Welcome</h1><p>Book a demo with our team today and grow your pipeline.</p>".repeat(
            8,
          ),
        },
      ]),
    });
    expect(home.status).toBe("SUCCESS");
    expect(home.errorType).toBeNull();

    const json = await performHttpMonitorCheck("https://example.com/api", {
      resolver: resolverOf({ "example.com": [publicIp] }),
      transport: htmlTransport([
        {
          status: 200,
          contentType: "application/json",
          body: '{"error":"not found"}',
        },
      ]),
    });
    expect(json.status).toBe("SUCCESS");
    expect(json.soft404Score ?? null).toBeNull();
  });

  it("keeps HTTP 500 even when the body looks like a not-found page", async () => {
    const result = await performHttpMonitorCheck("https://example.com/boom", {
      resolver: resolverOf({ "example.com": [publicIp] }),
      transport: htmlTransport([
        {
          status: 500,
          contentType: "text/html",
          body: "<title>Page not found</title><h1>Page not found</h1>",
        },
      ]),
    });
    expect(result.errorType).toBe("HTTP_5XX");
  });

  it("lets SOFT_404 override latency DEGRADED", async () => {
    const result = await performHttpMonitorCheck("https://example.com/slow", {
      resolver: resolverOf({ "example.com": [publicIp] }),
      degradedLatencyMs: 1,
      transport: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return {
          statusCode: 200,
          headers: { "content-type": "text/html" },
          body: Buffer.from(
            "<title>Page not found</title><h1>Page not found</h1><p>Sorry, the page you are looking for does not exist.</p>",
          ),
        };
      },
    });
    expect(result.status).toBe("FAILURE");
    expect(result.errorType).toBe("SOFT_404");
  });

  it("detects a redirect that lands on a 200 not-found page", async () => {
    const result = await performHttpMonitorCheck(
      "https://example.com/original",
      {
        resolver: resolverOf({ "example.com": [publicIp] }),
        transport: htmlTransport([
          { status: 302, location: "/not-found-page" },
          {
            status: 200,
            contentType: "text/html",
            body: "<title>Page not found</title><h1>Page not found</h1><p>Sorry, the page you are looking for does not exist.</p>",
          },
        ]),
      },
    );
    expect(result.status).toBe("FAILURE");
    expect(result.errorType).toBe("SOFT_404");
    expect(result.requestedUrl).toBe("https://example.com/original");
    expect(result.finalUrl).toBe("https://example.com/not-found-page");
    expect(result.redirectCount).toBe(1);
  });

  it("does not treat a homepage redirect as a soft-404", async () => {
    const result = await performHttpMonitorCheck(
      "https://example.com/old-campaign",
      {
        resolver: resolverOf({ "example.com": [publicIp] }),
        transport: htmlTransport([
          { status: 301, location: "/" },
          {
            status: 200,
            contentType: "text/html",
            body: "<title>Acme</title><h1>Welcome</h1><p>Our summer campaign is live with new offers for homeowners.</p>".repeat(
              6,
            ),
          },
        ]),
      },
    );
    expect(result.status).toBe("SUCCESS");
    expect(result.finalUrl).toBe("https://example.com/");
  });

  it("skips PDF and image responses", async () => {
    const pdf = await performHttpMonitorCheck("https://example.com/file.pdf", {
      resolver: resolverOf({ "example.com": [publicIp] }),
      transport: htmlTransport([
        { status: 200, contentType: "application/pdf", body: "%PDF-1.4" },
      ]),
    });
    const image = await performHttpMonitorCheck(
      "https://example.com/hero.jpg",
      {
        resolver: resolverOf({ "example.com": [publicIp] }),
        transport: htmlTransport([
          { status: 200, contentType: "image/jpeg", body: "xxxx" },
        ]),
      },
    );
    expect(pdf.status).toBe("SUCCESS");
    expect(image.status).toBe("SUCCESS");
    expect(pdf.errorType).toBeNull();
  });

  it("reads only a bounded prefix of huge HTML", async () => {
    const prefix =
      "<title>Page not found</title><h1>Page not found</h1><p>Sorry, the page you are looking for does not exist.</p>";
    const result = await performHttpMonitorCheck("https://example.com/huge", {
      resolver: resolverOf({ "example.com": [publicIp] }),
      transport: async () => ({
        statusCode: 200,
        headers: { "content-type": "text/html" },
        body: Buffer.concat([Buffer.from(prefix), Buffer.alloc(250_000, 32)]),
        bodyTruncated: true,
      }),
    });
    expect(result.errorType).toBe("SOFT_404");
  });
});

describe("pinned DNS lookup", () => {
  it("returns the validated IP even if asked for another hostname", () => {
    const lookup = createPinnedLookup("93.184.216.34");
    lookup("evil.example.com", {}, (error, address, family) => {
      expect(error).toBeNull();
      expect(address).toBe("93.184.216.34");
      expect(family).toBe(4);
    });
    const options = buildPinnedRequestOptions({
      url: new URL("https://example.com/path"),
      ip: "93.184.216.34",
      headers: { "User-Agent": "LeadGuardBot/1.0" },
      timeoutMs: 1000,
      maxBodyBytes: 1024,
    });
    expect(options.hostname).toBe("93.184.216.34");
    expect(options.servername).toBe("example.com");
    const headers = options.headers as Record<string, string>;
    expect(headers.Host).toBe("example.com");
  });

  it("stops reading after maxBodyBytes and returns a truncated buffer", async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("x".repeat(20_000));
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected a TCP address");
    }
    try {
      const result = await defaultPinnedTransport({
        url: new URL(`http://example.com:${address.port}/huge`),
        ip: "127.0.0.1",
        headers: { "User-Agent": "LeadGuardBot/1.0" },
        timeoutMs: 2000,
        maxBodyBytes: 2048,
      });
      expect(result.statusCode).toBe(200);
      expect(result.body?.byteLength).toBeLessThanOrEqual(2048);
      expect(result.bodyTruncated).toBe(true);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});
