import { describe, expect, it } from "vitest";
import {
  assertPublicHttpTarget,
  resolveSafeOutboundTarget,
  type DnsResolver,
} from "./ssrf";
import { UrlValidationError } from "./errors";

const publicIpv4 = "93.184.216.34";

function resolverOf(map: Record<string, string[]>): DnsResolver {
  return async (hostname) => map[hostname] ?? [];
}

function publicResolver(): DnsResolver {
  return async () => [publicIpv4];
}

async function expectBlocked(input: string, resolver?: DnsResolver) {
  await expect(
    resolveSafeOutboundTarget(input, {
      resolver: resolver ?? publicResolver(),
    }),
  ).rejects.toBeInstanceOf(UrlValidationError);
}

describe("resolveSafeOutboundTarget", () => {
  it("allows public http and https origins including subdomains", async () => {
    const resolver = publicResolver();
    await expect(
      resolveSafeOutboundTarget("https://example.com", { resolver }),
    ).resolves.toMatchObject({
      normalizedUrl: "https://example.com",
      hostname: "example.com",
      dnsStatus: "RESOLVED",
      resolvedAddresses: [publicIpv4],
    });
    await expect(
      resolveSafeOutboundTarget("http://example.com", { resolver }),
    ).resolves.toMatchObject({ scheme: "http", port: 80 });
    await expect(
      resolveSafeOutboundTarget("https://subdomain.example.com", { resolver }),
    ).resolves.toMatchObject({ hostname: "subdomain.example.com" });
  });

  it("blocks private, loopback, metadata, and alternative IP representations", async () => {
    const blocked = [
      "http://localhost",
      "http://127.0.0.1",
      "http://127.1",
      "http://0.0.0.0",
      "http://10.0.0.1",
      "http://172.16.0.1",
      "http://192.168.1.1",
      "http://169.254.169.254",
      "http://[::1]",
      "http://[fc00::1]",
      "http://[fe80::1]",
      "http://2130706433",
      "http://0x7f000001",
      "http://017700000001",
      "http://[::ffff:127.0.0.1]",
      "http://[::ffff:169.254.169.254]",
    ];
    for (const input of blocked) {
      await expectBlocked(input);
    }
  });

  it("blocks credentials and disallowed schemes without treating them as valid websites", async () => {
    await expectBlocked("https://user:pass@example.com");
    await expectBlocked("file:///etc/passwd");
    await expectBlocked("ftp://example.com");
    await expectBlocked("javascript:alert(1)");
  });

  it("blocks a hostname that resolves to any private address", async () => {
    const resolver = resolverOf({
      "evil.example.com": ["127.0.0.1"],
    });
    await expectBlocked("https://evil.example.com", resolver);
  });

  it("blocks a hostname when any of multiple resolved addresses is private", async () => {
    const resolver = resolverOf({
      "example.com": [publicIpv4, "127.0.0.1"],
    });
    await expectBlocked("https://example.com", resolver);
  });

  it("allows an unresolved public hostname during website creation", async () => {
    const result = await resolveSafeOutboundTarget(
      "https://future-site.example.com",
      { resolver: async () => [] },
    );
    expect(result.dnsStatus).toBe("UNRESOLVED");
    expect(result.resolvedAddresses).toEqual([]);
    expect(result.normalizedUrl).toBe("https://future-site.example.com");
  });

  it("requires a currently public resolved target for the worker contract", async () => {
    await expect(
      assertPublicHttpTarget("https://future-site.example.com", {
        resolver: async () => [],
      }),
    ).rejects.toBeInstanceOf(UrlValidationError);

    await expect(
      assertPublicHttpTarget("https://example.com", {
        resolver: publicResolver(),
      }),
    ).resolves.toMatchObject({ dnsStatus: "RESOLVED" });

    await expect(
      assertPublicHttpTarget("https://rebinding.example.com", {
        resolver: async () => ["10.0.0.1"],
      }),
    ).rejects.toBeInstanceOf(UrlValidationError);
  });
});
