import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildZoomUrlValidationResponse, verifyZoomWebhookSignature } from "./zoom-webhook-signature";

const SECRET = "test-secret-token";

function sign(rawBody: string, timestamp: string, secret: string): string {
  return `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${rawBody}`).digest("hex")}`;
}

describe("verifyZoomWebhookSignature", () => {
  it("accepts a correctly signed payload", () => {
    const rawBody = JSON.stringify({ event: "meeting.started" });
    const timestamp = "1700000000";
    const signature = sign(rawBody, timestamp, SECRET);
    expect(verifyZoomWebhookSignature(rawBody, timestamp, signature, SECRET)).toBe(true);
  });

  it("rejects a payload that was tampered with after signing", () => {
    const rawBody = JSON.stringify({ event: "meeting.started" });
    const timestamp = "1700000000";
    const signature = sign(rawBody, timestamp, SECRET);
    const tamperedBody = JSON.stringify({ event: "meeting.ended" });
    expect(verifyZoomWebhookSignature(tamperedBody, timestamp, signature, SECRET)).toBe(false);
  });

  it("rejects a signature produced with the wrong secret", () => {
    const rawBody = JSON.stringify({ event: "meeting.started" });
    const timestamp = "1700000000";
    const signature = sign(rawBody, timestamp, "wrong-secret");
    expect(verifyZoomWebhookSignature(rawBody, timestamp, signature, SECRET)).toBe(false);
  });

  it("rejects a malformed signature without throwing", () => {
    expect(verifyZoomWebhookSignature("{}", "1700000000", "not-a-real-signature", SECRET)).toBe(false);
  });
});

describe("buildZoomUrlValidationResponse", () => {
  it("returns the plainToken alongside its HMAC using the webhook secret", () => {
    const response = buildZoomUrlValidationResponse("abc123", SECRET);
    expect(response.plainToken).toBe("abc123");
    expect(response.encryptedToken).toBe(createHmac("sha256", SECRET).update("abc123").digest("hex"));
  });
});
