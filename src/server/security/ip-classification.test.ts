import { describe, expect, it } from "vitest";
import { isBlockedIpAddress } from "./ip-classification";

describe("isBlockedIpAddress", () => {
  it("blocks loopback, private, link-local, CGNAT, and unspecified IPv4", () => {
    for (const address of [
      "127.0.0.1",
      "127.1.2.3",
      "10.0.0.1",
      "172.16.0.1",
      "192.168.1.1",
      "169.254.1.1",
      "169.254.169.254",
      "0.0.0.0",
      "100.64.0.1",
      "224.0.0.1",
      "240.0.0.1",
    ]) {
      expect(isBlockedIpAddress(address), address).toBe(true);
    }
  });

  it("blocks loopback, unique-local, link-local IPv6 and cloud metadata", () => {
    for (const address of [
      "::1",
      "fc00::1",
      "fd12:3456:789a::1",
      "fe80::1",
      "ff00::1",
      "fd00:ec2::254",
      "::ffff:127.0.0.1",
      "::ffff:169.254.169.254",
    ]) {
      expect(isBlockedIpAddress(address), address).toBe(true);
    }
  });

  it("allows public unicast addresses", () => {
    expect(isBlockedIpAddress("93.184.216.34")).toBe(false);
    expect(isBlockedIpAddress("8.8.8.8")).toBe(false);
    expect(isBlockedIpAddress("2001:4860:4860::8888")).toBe(false);
  });

  it("fails closed on values that are not IP addresses", () => {
    expect(isBlockedIpAddress("not-an-ip")).toBe(true);
    expect(isBlockedIpAddress("")).toBe(true);
  });
});
