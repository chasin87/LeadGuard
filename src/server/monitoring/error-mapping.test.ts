import { describe, expect, it } from "vitest";
import { mapNetworkError } from "./error-mapping";

describe("mapNetworkError", () => {
  it("maps timeout, DNS, SSL and connection codes", () => {
    expect(
      mapNetworkError({ code: "ETIMEDOUT", message: "timeout" }).errorType,
    ).toBe("TIMEOUT");
    expect(mapNetworkError({ code: "ENOTFOUND" }).errorType).toBe("DNS_ERROR");
    expect(mapNetworkError({ code: "EAI_AGAIN" }).errorType).toBe("DNS_ERROR");
    expect(mapNetworkError({ code: "CERT_HAS_EXPIRED" }).errorType).toBe(
      "SSL_ERROR",
    );
    expect(
      mapNetworkError({ code: "ERR_TLS_CERT_ALTNAME_INVALID" }).errorType,
    ).toBe("SSL_ERROR");
    expect(mapNetworkError({ code: "ENETUNREACH" }).errorType).toBe(
      "CONNECTION_ERROR",
    );
    expect(mapNetworkError({ code: "ECONNREFUSED" }).errorType).toBe(
      "CONNECTION_ERROR",
    );
    expect(mapNetworkError({ code: "ECONNRESET" }).errorType).toBe(
      "CONNECTION_ERROR",
    );
  });
});
