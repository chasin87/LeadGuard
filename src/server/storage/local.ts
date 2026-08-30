import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ArtifactObject, ArtifactStorage } from "@/server/storage/types";

export class LocalArtifactStorage implements ArtifactStorage {
  readonly driver = "local" as const;

  constructor(private readonly rootDirectory: string) {}

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    void contentType;
    const filePath = this.resolve(key);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, body);
  }

  async get(key: string): Promise<ArtifactObject | null> {
    try {
      const body = await readFile(this.resolve(key));
      return { body, contentType: contentTypeForKey(key) };
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.resolve(key));
    } catch {
      // Missing files are already gone.
    }
  }

  async getSignedUrl(key: string): Promise<string | null> {
    void key;
    return null;
  }

  private resolve(key: string): string {
    const safe = assertSafeKey(key);
    const resolved = path.resolve(this.rootDirectory, safe);
    const root = path.resolve(this.rootDirectory);
    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
      throw new Error("Artifact key escapes storage root.");
    }
    return resolved;
  }
}

export function assertSafeKey(key: string): string {
  const normalized = key.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("..") || path.isAbsolute(normalized)) {
    throw new Error("Invalid artifact key.");
  }
  return normalized;
}

function contentTypeForKey(key: string): string {
  if (key.endsWith(".webp")) return "image/webp";
  if (key.endsWith(".png")) return "image/png";
  return "image/jpeg";
}
