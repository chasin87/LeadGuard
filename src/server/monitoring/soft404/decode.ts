import {
  brotliDecompressSync,
  gunzipSync,
  inflateSync,
  unzipSync,
} from "node:zlib";
import { parseContentTypeHeader } from "@/server/monitoring/soft404/content-type";
import { SOFT404_MAX_BODY_BYTES } from "@/server/monitoring/soft404/config";

const CHARSET_ALIASES: Record<string, string> = {
  utf8: "utf-8",
  "utf-8": "utf-8",
  "utf-16": "utf-16le",
  "utf-16le": "utf-16le",
  "utf-16be": "utf-16be",
  latin1: "latin1",
  "iso-8859-1": "latin1",
  "windows-1252": "windows-1252",
  ascii: "utf-8",
};

function cap(buffer: Buffer, maxBytes: number): Buffer {
  return buffer.length > maxBytes ? buffer.subarray(0, maxBytes) : buffer;
}

export function decompressHttpBody(
  body: Buffer,
  contentEncoding: string | null | undefined,
  maxBytes = SOFT404_MAX_BODY_BYTES,
): Buffer {
  const limited = cap(body, maxBytes);
  const encoding = contentEncoding?.split(",")[0]?.trim().toLowerCase();
  if (!encoding || encoding === "identity") return limited;

  const options = { maxOutputLength: maxBytes };
  try {
    if (encoding === "gzip" || encoding === "x-gzip") {
      return gunzipSync(limited, options);
    }
    if (encoding === "br") {
      return brotliDecompressSync(limited, options);
    }
    if (encoding === "deflate") {
      try {
        return inflateSync(limited, options);
      } catch {
        return unzipSync(limited, options);
      }
    }
  } catch {
    return limited;
  }
  return limited;
}

function sniffBomCharset(body: Buffer): string | null {
  if (
    body.length >= 3 &&
    body[0] === 0xef &&
    body[1] === 0xbb &&
    body[2] === 0xbf
  ) {
    return "utf-8";
  }
  if (body.length >= 2 && body[0] === 0xff && body[1] === 0xfe) {
    return "utf-16le";
  }
  if (body.length >= 2 && body[0] === 0xfe && body[1] === 0xff) {
    return "utf-16be";
  }
  return null;
}

export function decodeHttpBody(
  body: Buffer,
  contentType: string | null | undefined,
): string {
  const parsed = parseContentTypeHeader(contentType);
  const charset = parsed?.charset ?? sniffBomCharset(body) ?? "utf-8";
  const encoding = CHARSET_ALIASES[charset] ?? "utf-8";
  try {
    return new TextDecoder(encoding, { fatal: false }).decode(body);
  } catch {
    return new TextDecoder("utf-8", { fatal: false }).decode(body);
  }
}
