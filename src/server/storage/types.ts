export type ArtifactObject = {
  body: Buffer;
  contentType: string;
};

export type ArtifactStorage = {
  driver: "local" | "s3";
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<ArtifactObject | null>;
  delete(key: string): Promise<void>;
  getSignedUrl(key: string, expiresInSeconds?: number): Promise<string | null>;
};
