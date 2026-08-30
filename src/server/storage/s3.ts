import { createHash, createHmac } from "node:crypto";
import type { ArtifactObject, ArtifactStorage } from "@/server/storage/types";
import { assertSafeKey } from "@/server/storage/local";

export type S3ArtifactStorageOptions = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
};

export class S3ArtifactStorage implements ArtifactStorage {
  readonly driver = "s3" as const;

  constructor(private readonly options: S3ArtifactStorageOptions) {}

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    const safe = assertSafeKey(key);
    const response = await this.request("PUT", safe, {
      body,
      contentType,
    });
    if (!response.ok) {
      throw new Error(`S3 put failed with HTTP ${response.status}.`);
    }
  }

  async get(key: string): Promise<ArtifactObject | null> {
    const safe = assertSafeKey(key);
    const response = await this.request("GET", safe);
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`S3 get failed with HTTP ${response.status}.`);
    }
    const body = Buffer.from(await response.arrayBuffer());
    const contentType =
      response.headers.get("content-type") ?? "application/octet-stream";
    return { body, contentType };
  }

  async delete(key: string): Promise<void> {
    const safe = assertSafeKey(key);
    const response = await this.request("DELETE", safe);
    if (!response.ok && response.status !== 404) {
      throw new Error(`S3 delete failed with HTTP ${response.status}.`);
    }
  }

  async getSignedUrl(key: string, expiresInSeconds = 60): Promise<string> {
    const safe = assertSafeKey(key);
    return this.presign("GET", safe, expiresInSeconds);
  }

  private objectUrl(key: string): URL {
    const endpoint = new URL(this.options.endpoint);
    if (this.options.forcePathStyle ?? true) {
      endpoint.pathname = `/${this.options.bucket}/${key}`;
      return endpoint;
    }
    endpoint.hostname = `${this.options.bucket}.${endpoint.hostname}`;
    endpoint.pathname = `/${key}`;
    return endpoint;
  }

  private async request(
    method: string,
    key: string,
    extra?: { body?: Buffer; contentType?: string },
  ): Promise<Response> {
    const url = this.objectUrl(key);
    const headers = this.signHeaders(
      method,
      url,
      extra?.body,
      extra?.contentType,
    );
    return fetch(url, {
      method,
      headers,
      body: extra?.body ? new Uint8Array(extra.body) : undefined,
    });
  }

  private signHeaders(
    method: string,
    url: URL,
    body?: Buffer,
    contentType?: string,
  ): Record<string, string> {
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = sha256Hex(body ?? Buffer.alloc(0));
    const headers: Record<string, string> = {
      host: url.host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    };
    if (contentType) headers["content-type"] = contentType;

    const signedHeaderNames = Object.keys(headers).sort();
    const canonicalHeaders = signedHeaderNames
      .map((name) => `${name}:${headers[name]}\n`)
      .join("");
    const signedHeaders = signedHeaderNames.join(";");
    const canonicalRequest = [
      method,
      url.pathname,
      url.searchParams.toString(),
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");

    const credentialScope = `${dateStamp}/${this.options.region}/s3/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      sha256Hex(canonicalRequest),
    ].join("\n");
    const signature = hmacHex(this.signingKey(dateStamp), stringToSign);
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${this.options.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    return headers;
  }

  private presign(
    method: string,
    key: string,
    expiresInSeconds: number,
  ): string {
    const url = this.objectUrl(key);
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.slice(0, 8);
    const credentialScope = `${dateStamp}/${this.options.region}/s3/aws4_request`;
    const credential = `${this.options.accessKeyId}/${credentialScope}`;
    url.searchParams.set("X-Amz-Algorithm", "AWS4-HMAC-SHA256");
    url.searchParams.set("X-Amz-Credential", credential);
    url.searchParams.set("X-Amz-Date", amzDate);
    url.searchParams.set("X-Amz-Expires", String(expiresInSeconds));
    url.searchParams.set("X-Amz-SignedHeaders", "host");

    const canonicalRequest = [
      method,
      url.pathname,
      [...url.searchParams.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(
          ([name, value]) =>
            `${encodeURIComponent(name)}=${encodeURIComponent(value)}`,
        )
        .join("&"),
      `host:${url.host}\n`,
      "host",
      "UNSIGNED-PAYLOAD",
    ].join("\n");
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      sha256Hex(canonicalRequest),
    ].join("\n");
    const signature = hmacHex(this.signingKey(dateStamp), stringToSign);
    url.searchParams.set("X-Amz-Signature", signature);
    return url.toString();
  }

  private signingKey(dateStamp: string): Buffer {
    const kDate = hmac(`AWS4${this.options.secretAccessKey}`, dateStamp);
    const kRegion = hmac(kDate, this.options.region);
    const kService = hmac(kRegion, "s3");
    return hmac(kService, "aws4_request");
  }
}

function sha256Hex(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key: string | Buffer, value: string): Buffer {
  return createHmac("sha256", key).update(value).digest();
}

function hmacHex(key: Buffer, value: string): string {
  return createHmac("sha256", key).update(value).digest("hex");
}
