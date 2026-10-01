import { createHmac, timingSafeEqual } from "node:crypto";

/** Reject deliveries whose timestamp is more than this far from now (replay protection). */
export const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

export interface WebhookSignatureHeaders {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
}

/** Recall signs with Svix-style headers; newer endpoints use the standard-webhooks names. */
export function readWebhookSignatureHeaders(headers: Headers): WebhookSignatureHeaders {
  return {
    id: headers.get("webhook-id") ?? headers.get("svix-id"),
    timestamp: headers.get("webhook-timestamp") ?? headers.get("svix-timestamp"),
    signature: headers.get("webhook-signature") ?? headers.get("svix-signature"),
  };
}

/**
 * Verifies a Recall.ai webhook: HMAC-SHA256 over `${id}.${timestamp}.${rawBody}`
 * keyed with the base64-decoded secret (after its `whsec_` prefix), compared
 * against every space-separated `v1,<base64>` entry in the signature header.
 */
export function verifyRecallWebhookSignature(
  rawBody: string,
  headers: WebhookSignatureHeaders,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > WEBHOOK_TOLERANCE_SECONDS) return false;

  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  if (key.length === 0) return false;
  const expected = Buffer.from(createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody}`).digest("base64"));

  return signature.split(" ").some((entry) => {
    const [version, sig] = entry.split(",");
    if (version !== "v1" || !sig) return false;
    const given = Buffer.from(sig);
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}
