import { describe, expect, it } from "vitest";
import {
  isSameWebsiteOrigin,
  parseHttpUrlInput,
  parseWebsiteOriginInput,
  resolveMonitorUrlAgainstWebsite,
} from "./normalize-url";
import { UrlValidationError } from "@/server/security/errors";

function expectReason(input: string, reason: string) {
  try {
    parseWebsiteOriginInput(input);
    throw new Error(`Expected ${input} to be rejected`);
  } catch (error) {
    expect(error).toBeInstanceOf(UrlValidationError);
    expect((error as UrlValidationError).reason).toBe(reason);
  }
}

describe("parseWebsiteOriginInput", () => {
  it("defaults to https and stores an origin without a trailing slash", () => {
    expect(parseWebsiteOriginInput("voltiosenergie.nl")).toMatchObject({
      normalizedUrl: "https://voltiosenergie.nl",
      hostname: "voltiosenergie.nl",
      scheme: "https",
      port: 443,
    });
    expect(parseWebsiteOriginInput("https://voltiosenergie.nl/")).toMatchObject(
      {
        normalizedUrl: "https://voltiosenergie.nl",
      },
    );
  });

  it("keeps explicit http and does not treat www as the same host", () => {
    expect(parseWebsiteOriginInput("http://example.com")).toMatchObject({
      normalizedUrl: "http://example.com",
      scheme: "http",
      port: 80,
    });
    expect(parseWebsiteOriginInput("https://www.example.com").hostname).toBe(
      "www.example.com",
    );
    expect(parseWebsiteOriginInput("https://example.com").hostname).toBe(
      "example.com",
    );
  });

  it("lowercases hostnames and trims whitespace", () => {
    expect(
      parseWebsiteOriginInput("  HTTPS://WWW.Example.COM  "),
    ).toMatchObject({
      normalizedUrl: "https://www.example.com",
      hostname: "www.example.com",
    });
  });

  it("rejects credentials, fragments, paths, and queries", () => {
    expectReason("https://user:pass@example.com", "credentials_not_allowed");
    expectReason("https://example.com/airco", "origin_only");
    expectReason("https://example.com/?utm_source=x", "origin_only");
    expectReason("https://example.com/#section", "origin_only");
  });

  it("rejects disallowed schemes", () => {
    for (const input of [
      "file:///etc/passwd",
      "ftp://example.com",
      "javascript:alert(1)",
      "data:text/html,hello",
      "gopher://example.com",
      "ssh://example.com",
    ]) {
      expectReason(input, "unsupported_scheme");
    }
  });

  it("rejects localhost-style hostnames and internal suffixes", () => {
    expectReason("http://localhost", "internal_hostname");
    expectReason("http://localhost:3000", "internal_hostname");
    expectReason("https://printer.local", "internal_hostname");
    expectReason("https://vault.internal", "internal_hostname");
  });

  it("rejects non-default ports", () => {
    expectReason("https://example.com:5432", "port_not_allowed");
    expectReason("http://example.com:22", "port_not_allowed");
    expectReason("https://example.com:8443", "port_not_allowed");
  });

  it("canonicalizes alternative IPv4 representations before later IP checks", () => {
    expect(parseWebsiteOriginInput("http://127.1").hostname).toBe("127.0.0.1");
    expect(parseWebsiteOriginInput("http://2130706433").hostname).toBe(
      "127.0.0.1",
    );
    expect(parseWebsiteOriginInput("http://0x7f000001").hostname).toBe(
      "127.0.0.1",
    );
    expect(parseWebsiteOriginInput("http://017700000001").hostname).toBe(
      "127.0.0.1",
    );
  });
});

describe("parseHttpUrlInput for monitors", () => {
  it("allows paths on the same origin and treats www as a different host", () => {
    expect(parseHttpUrlInput("https://example.com/airco")).toMatchObject({
      origin: "https://example.com",
      pathname: "/airco",
      normalizedUrl: "https://example.com/airco",
    });
    expect(
      isSameWebsiteOrigin(
        { scheme: "https", hostname: "example.com", port: 443 },
        parseHttpUrlInput("https://example.com/airco"),
      ),
    ).toBe(true);
    expect(
      isSameWebsiteOrigin(
        { scheme: "https", hostname: "example.com", port: 443 },
        parseHttpUrlInput("https://www.example.com/airco"),
      ),
    ).toBe(false);
    expect(
      resolveMonitorUrlAgainstWebsite("/offerte", "https://example.com")
        .normalizedUrl,
    ).toBe("https://example.com/offerte");
  });
});
