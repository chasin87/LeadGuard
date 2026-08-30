import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  decodeHttpBody,
  decompressHttpBody,
} from "@/server/monitoring/soft404/decode";
import { isAnalyzableContentType } from "@/server/monitoring/soft404/content-type";

describe("soft404 decode and content-type", () => {
  it("decompresses gzip and respects max output length", () => {
    const html = Buffer.from("<h1>Page not found</h1>");
    const compressed = gzipSync(html);
    expect(decompressHttpBody(compressed, "gzip").toString("utf8")).toContain(
      "Page not found",
    );
    const bomb = gzipSync(Buffer.alloc(400_000, 65));
    const out = decompressHttpBody(bomb, "gzip", 1024);
    expect(out.byteLength).toBeLessThanOrEqual(1024);
  });

  it("uses the declared charset when present", () => {
    const text = decodeHttpBody(
      Buffer.from("Pagina", "utf8"),
      "text/html; charset=utf-8",
    );
    expect(text).toContain("Pagina");
  });

  it("treats missing content-type as HTML only when the body looks like HTML", () => {
    expect(
      isAnalyzableContentType(null, Buffer.from("<!doctype html><html>")),
    ).toBe(true);
    expect(isAnalyzableContentType(null, Buffer.from("%PDF-1.4"))).toBe(false);
    expect(isAnalyzableContentType("text/html", Buffer.from("x"))).toBe(true);
    expect(isAnalyzableContentType("application/json", Buffer.from("{}"))).toBe(
      false,
    );
  });
});
