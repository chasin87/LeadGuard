import path from "node:path";
import { LocalArtifactStorage } from "@/server/storage/local";
import { S3ArtifactStorage } from "@/server/storage/s3";
import type { ArtifactStorage } from "@/server/storage/types";

let cached: ArtifactStorage | undefined;

export function getArtifactStorage(): ArtifactStorage {
  cached ??= createArtifactStorage();
  return cached;
}

export function resetArtifactStorageForTests(): void {
  cached = undefined;
}

function createArtifactStorage(): ArtifactStorage {
  const driver = (process.env.ARTIFACT_STORAGE_DRIVER ?? "local").toLowerCase();
  if (
    process.env.NODE_ENV === "production" &&
    process.env.E2E_RUNTIME !== "true" &&
    driver !== "s3"
  ) {
    throw new Error(
      "ARTIFACT_STORAGE_DRIVER=s3 is required in production. Local artifact storage is not allowed.",
    );
  }
  if (driver === "s3") {
    const endpoint = required("S3_ENDPOINT");
    const bucket = required("S3_BUCKET");
    const accessKeyId = required("S3_ACCESS_KEY_ID");
    const secretAccessKey = required("S3_SECRET_ACCESS_KEY");
    return new S3ArtifactStorage({
      endpoint,
      region: process.env.S3_REGION?.trim() || "auto",
      bucket,
      accessKeyId,
      secretAccessKey,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
    });
  }

  const root =
    process.env.ARTIFACT_STORAGE_LOCAL_DIR?.trim() ||
    path.resolve(process.cwd(), ".leadguard-artifacts");
  return new LocalArtifactStorage(root);
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required when ARTIFACT_STORAGE_DRIVER=s3.`);
  }
  return value;
}
