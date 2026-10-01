import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyRecallWebhookSignature } from "./recall-webhook-signature";

const keyBytes = Buffer.from("super-secret-signing-key-123456");
const secret = `whsec_${keyBytes.toString("base64")}`;
const body = JSON.stringify({ event: "bot.done", data: { bot: { id: "b1" } } });
const now = 1_790_000_000;

function sign(id: string, ts: number, payload: string, key = keyBytes) {
  return `v1,${createHmac("sha256", key).update(`${id}.${ts}.${payload}`).digest("base64")}`;
}

describe("verifyRecallWebhookSignature", () => {
  it("accepts a correctly signed delivery", () => {
    const headers = { id: "msg_1", timestamp: String(now), signature: sign("msg_1", now, body) };
    expect(verifyRecallWebhookSignature(body, headers, secret, now)).toBe(true);
  });

  it("accepts when any of several space-separated signatures matches (key rotation)", () => {
    const headers = { id: "msg_1", timestamp: String(now), signature: `v1,bm9wZQ== ${sign("msg_1", now, body)}` };
    expect(verifyRecallWebhookSignature(body, headers, secret, now)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const headers = { id: "msg_1", timestamp: String(now), signature: sign("msg_1", now, body) };
    expect(verifyRecallWebhookSignature(body.replace("b1", "b2"), headers, secret, now)).toBe(false);
  });

  it("rejects a signature made with a different secret", () => {
    const headers = { id: "msg_1", timestamp: String(now), signature: sign("msg_1", now, body, Buffer.from("other-key")) };
    expect(verifyRecallWebhookSignature(body, headers, secret, now)).toBe(false);
  });

  it("rejects stale timestamps (replay)", () => {
    const old = now - 3600;
    const headers = { id: "msg_1", timestamp: String(old), signature: sign("msg_1", old, body) };
    expect(verifyRecallWebhookSignature(body, headers, secret, now)).toBe(false);
  });

  it("rejects missing headers", () => {
    expect(verifyRecallWebhookSignature(body, { id: null, timestamp: String(now), signature: "v1,x" }, secret, now)).toBe(false);
  });
});
