import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const BUCKET = process.env.STORAGE_BUCKET ?? "meeting-assistant";

const s3 = new S3Client({
  region: process.env.STORAGE_REGION ?? "us-east-1",
  endpoint: process.env.STORAGE_ENDPOINT,
  forcePathStyle: process.env.STORAGE_FORCE_PATH_STYLE === "true",
  credentials:
    process.env.STORAGE_ACCESS_KEY_ID && process.env.STORAGE_SECRET_ACCESS_KEY
      ? { accessKeyId: process.env.STORAGE_ACCESS_KEY_ID, secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY }
      : undefined,
});

export function buildStorageKey(prefix: string, meetingSessionId: string, fileName: string): string {
  return `${prefix}/${meetingSessionId}/${crypto.randomUUID()}-${fileName}`;
}

/**
 * The worker has direct storage credentials (unlike the web app, which only
 * ever hands out short-lived signed URLs to browsers), so it uploads
 * server-side buffers directly rather than presigning.
 */
export async function uploadBuffer(storageKey: string, body: Buffer, contentType: string): Promise<void> {
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: storageKey, Body: body, ContentType: contentType }));
}
