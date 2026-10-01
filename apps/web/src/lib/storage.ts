import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const BUCKET = process.env.STORAGE_BUCKET ?? "meeting-assistant";
const UPLOAD_URL_TTL_SECONDS = 15 * 60;
const DOWNLOAD_URL_TTL_SECONDS = 10 * 60;

declare global {
  var __s3Client: S3Client | undefined;
}

/**
 * S3-compatible private object storage (MinIO locally, S3/R2 in
 * production). Everything is private-by-default: callers never get a
 * public URL, only short-lived signed URLs for the one upload/download they
 * need, matching the "keep recordings private by default" requirement.
 */
const s3: S3Client =
  globalThis.__s3Client ??
  new S3Client({
    region: process.env.STORAGE_REGION ?? "us-east-1",
    endpoint: process.env.STORAGE_ENDPOINT,
    forcePathStyle: process.env.STORAGE_FORCE_PATH_STYLE === "true",
    credentials:
      process.env.STORAGE_ACCESS_KEY_ID && process.env.STORAGE_SECRET_ACCESS_KEY
        ? {
            accessKeyId: process.env.STORAGE_ACCESS_KEY_ID,
            secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY,
          }
        : undefined,
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__s3Client = s3;
}

export function buildStorageKey(prefix: string, userId: string, fileName: string): string {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${prefix}/${userId}/${crypto.randomUUID()}-${safeName}`;
}

export async function getUploadUrl(storageKey: string, mimeType: string): Promise<string> {
  const command = new PutObjectCommand({ Bucket: BUCKET, Key: storageKey, ContentType: mimeType });
  return getSignedUrl(s3, command, { expiresIn: UPLOAD_URL_TTL_SECONDS });
}

export async function getDownloadUrl(storageKey: string): Promise<string> {
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: storageKey });
  return getSignedUrl(s3, command, { expiresIn: DOWNLOAD_URL_TTL_SECONDS });
}

export async function deleteObject(storageKey: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: storageKey }));
}

/** Throws if the object doesn't exist. Used to confirm a client-side upload actually landed. */
export async function headObject(storageKey: string) {
  return s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: storageKey }));
}
