import { Parser } from "htmlparser2";
import {
  SOFT404_MAX_BODY_BYTES,
  SOFT404_MAX_TEXT_CHARS,
} from "@/server/monitoring/soft404/config";
import type { ExtractedPage } from "@/server/monitoring/soft404/types";
import { normalizeAnalysisText } from "@/server/monitoring/soft404/phrases";

const SKIP_TAGS = new Set([
  "script",
  "style",
  "noscript",
  "svg",
  "template",
  "iframe",
]);

function pushLimited(target: string, addition: string, max: number): string {
  if (target.length >= max) return target;
  const remaining = max - target.length;
  return remaining >= addition.length
    ? target + addition
    : target + addition.slice(0, remaining);
}

export function extractPage(html: string): ExtractedPage {
  const input =
    html.length > SOFT404_MAX_BODY_BYTES
      ? html.slice(0, SOFT404_MAX_BODY_BYTES)
      : html;

  let skipDepth = 0;
  let inTitle = 0;
  let inH1 = 0;
  let inH2 = 0;
  let currentH1 = "";
  let currentH2 = "";
  let title = "";
  const h1: string[] = [];
  const h2: string[] = [];
  let bodyText = "";
  let robots = "";
  let canonical: string | null = null;

  const parser = new Parser(
    {
      onopentag(name, attribs) {
        const tag = name.toLowerCase();
        if (skipDepth > 0) {
          skipDepth += 1;
          return;
        }
        if (SKIP_TAGS.has(tag)) {
          skipDepth = 1;
          return;
        }
        if (tag === "title") inTitle += 1;
        if (tag === "h1") {
          inH1 += 1;
          currentH1 = "";
        }
        if (tag === "h2") {
          inH2 += 1;
          currentH2 = "";
        }
        if (tag === "meta") {
          const metaName = (
            attribs.name ??
            attribs.property ??
            ""
          ).toLowerCase();
          if (metaName === "robots") {
            robots = attribs.content ?? "";
          }
        }
        if (tag === "link") {
          const rel = (attribs.rel ?? "").toLowerCase();
          if (rel.includes("canonical") && attribs.href) {
            canonical = attribs.href;
          }
        }
        if (
          tag === "p" ||
          tag === "div" ||
          tag === "br" ||
          tag === "li" ||
          tag === "h3" ||
          tag === "h4"
        ) {
          bodyText = pushLimited(bodyText, " ", SOFT404_MAX_TEXT_CHARS);
        }
      },
      ontext(text) {
        if (skipDepth > 0) return;
        if (inTitle > 0) {
          title += text;
          return;
        }
        if (inH1 > 0) {
          currentH1 += text;
          return;
        }
        if (inH2 > 0) {
          currentH2 += text;
          return;
        }
        bodyText = pushLimited(bodyText, text, SOFT404_MAX_TEXT_CHARS);
      },
      onclosetag(name) {
        const tag = name.toLowerCase();
        if (skipDepth > 0) {
          skipDepth -= 1;
          return;
        }
        if (tag === "title" && inTitle > 0) inTitle -= 1;
        if (tag === "h1" && inH1 > 0) {
          inH1 -= 1;
          const value = normalizeAnalysisText(currentH1);
          if (value) h1.push(value);
          currentH1 = "";
        }
        if (tag === "h2" && inH2 > 0) {
          inH2 -= 1;
          const value = normalizeAnalysisText(currentH2);
          if (value) h2.push(value);
          currentH2 = "";
        }
      },
    },
    { decodeEntities: true, xmlMode: false },
  );

  parser.write(input);
  parser.end();

  return {
    title: normalizeAnalysisText(title),
    h1,
    h2,
    bodyText: normalizeAnalysisText(bodyText),
    robots: robots.toLowerCase(),
    canonical,
  };
}
