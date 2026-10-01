import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifies Zoom's webhook signature (https://developers.zoom.us/docs/api/webhooks/#verify-webhook-events):
 * expected = "v0=" + HMAC_SHA256(`v0:${timestamp}:${rawBody}`, secret).hex()
 */
export function verifyZoomWebhookSignature(
  rawBody: string,
  timestamp: string,
  signature: string,
  secret: string,
): boolean {
  const message = `v0:${timestamp}:${rawBody}`;
  const expected = `v0=${createHmac("sha256", secret).update(message).digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The response Zoom's one-time endpoint.url_validation challenge expects. */
export function buildZoomUrlValidationResponse(plainToken: string, secret: string) {
  return {
    plainToken,
    encryptedToken: createHmac("sha256", secret).update(plainToken).digest("hex"),
  };
}
