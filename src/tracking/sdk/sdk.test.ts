import { describe, expect, it } from "vitest";
import vm from "node:vm";
import { trackerV1Source } from "@/tracking/sdk/v1-source";

type FetchCall = { url: string; body: string };

function runSdk(input: {
  search: string;
  monitoring?: boolean;
  fetchImpl?: (calls: FetchCall[]) => void;
}) {
  const calls: FetchCall[] = [];
  const cookies = new Map<string, string>();
  const window: Record<string, unknown> = {
    __LEADGUARD_MONITORING__: Boolean(input.monitoring),
    location: {
      search: input.search,
      href: `https://example.nl/${input.search}`,
      pathname: "/",
      origin: "https://example.nl",
      protocol: "https:",
    },
  };
  const document = {
    currentScript: {
      getAttribute: (name: string) =>
        name === "data-site-key" ? "lg_site_testkeyaaaaaaaaaaaaaaaa" : null,
      src: "https://app.leadguard.test/tracker/v1.js",
    },
    referrer: "",
    cookie: "",
    querySelector: () => null,
    createElement: () => ({ type: "", name: "", value: "" }),
  };
  Object.defineProperty(document, "cookie", {
    get() {
      return [...cookies.entries()]
        .map(([name, value]) => `${name}=${value}`)
        .join("; ");
    },
    set(value: string) {
      const [pair] = value.split(";");
      const [name, raw] = (pair ?? "").split("=");
      if (!name) return;
      if (value.includes("Max-Age=0")) cookies.delete(name);
      else cookies.set(name, raw ?? "");
    },
  });
  const context = vm.createContext({
    window,
    document,
    location: window.location,
    crypto: globalThis.crypto,
    fetch: (url: string, init?: { body?: string }) => {
      calls.push({ url, body: String(init?.body ?? "") });
      return Promise.resolve({
        ok: true,
        json: async () => ({ ok: true, attributionToken: "lgat_test" }),
      });
    },
    URL,
    URLSearchParams,
    Promise,
    console,
    navigator: {},
    LeadGuard: undefined,
  });
  vm.runInContext(trackerV1Source, context);
  input.fetchImpl?.(calls);
  return {
    api: (
      context.window as {
        LeadGuard?: Record<string, (value?: unknown) => unknown>;
      }
    ).LeadGuard,
    cookies,
    calls,
  };
}

describe("tracking SDK consent and cookies", () => {
  it("does not transmit click IDs or set cookies while consent is unknown", () => {
    const { cookies, calls, api } = runSdk({ search: "?gclid=ABC123" });
    expect(api).toBeDefined();
    expect(calls).toHaveLength(0);
    expect(cookies.size).toBe(0);
  });

  it("does not persist cookies or click IDs when consent is denied", () => {
    const { cookies, calls, api } = runSdk({ search: "?gclid=ABC123" });
    api?.setConsent?.({ attribution: "denied" });
    expect(calls).toHaveLength(0);
    expect(cookies.size).toBe(0);
  });

  it("captures held click IDs after consent is granted on the same page", () => {
    const { cookies, calls, api } = runSdk({
      search: "?gclid=ABC123&gbraid=BRAID1",
    });
    api?.setConsent?.({ attribution: "granted" });
    expect(calls).toHaveLength(1);
    const body = JSON.parse(calls[0]?.body ?? "{}") as {
      clickIds: { gclid: string; gbraid: string };
      visitorId: string;
    };
    expect(body.clickIds.gclid).toBe("ABC123");
    expect(body.clickIds.gbraid).toBe("BRAID1");
    expect(body.visitorId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect([...cookies.keys()].join(",")).toContain("_lg_vid");
    expect([...cookies.values()].join(" ")).not.toContain("ABC123");
  });

  it("no-ops for synthetic LeadGuard monitors", () => {
    const { api, calls } = runSdk({
      search: "?gclid=MONITOR",
      monitoring: true,
    });
    expect(api).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it("does not rewrite the URL after capture", () => {
    expect(trackerV1Source).not.toContain("history.replaceState");
    expect(trackerV1Source).not.toContain("eval(");
    expect(trackerV1Source).not.toContain("new Function");
  });

  it("resolves ready after initialization", async () => {
    const { api } = runSdk({ search: "" });
    await expect(api?.ready?.()).resolves.toBeUndefined();
  });
});
