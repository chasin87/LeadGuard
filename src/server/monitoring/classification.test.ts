import { describe, expect, it } from "vitest";
import {
  classifyHttpStatus,
  classifySoft404Failure,
  isRedirectStatus,
} from "./classification";

describe("classifyHttpStatus", () => {
  it("treats 2xx as success and slow 2xx as degraded", () => {
    expect(classifyHttpStatus(200, 200).status).toBe("SUCCESS");
    expect(classifyHttpStatus(204, 100).status).toBe("SUCCESS");
    expect(classifyHttpStatus(200, 5001).status).toBe("DEGRADED");
  });

  it("classifies client and server failures", () => {
    expect(classifyHttpStatus(404, 10)).toMatchObject({
      status: "FAILURE",
      errorType: "HTTP_404",
    });
    expect(classifyHttpStatus(403, 10).errorType).toBe("HTTP_403");
    expect(classifyHttpStatus(401, 10).errorType).toBe("HTTP_401");
    expect(classifyHttpStatus(429, 10).errorType).toBe("HTTP_429");
    expect(classifyHttpStatus(418, 10).errorType).toBe("HTTP_4XX");
    expect(classifyHttpStatus(500, 10).errorType).toBe("HTTP_5XX");
    expect(classifyHttpStatus(503, 10).errorType).toBe("HTTP_5XX");
    expect(classifySoft404Failure()).toMatchObject({
      status: "FAILURE",
      errorType: "SOFT_404",
    });
  });

  it("recognizes redirect statuses used for following", () => {
    expect(isRedirectStatus(301)).toBe(true);
    expect(isRedirectStatus(302)).toBe(true);
    expect(isRedirectStatus(200)).toBe(false);
    expect(isRedirectStatus(404)).toBe(false);
  });
});
