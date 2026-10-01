import { logger } from "../logger.js";

let cachedToken: { token: string; expiresAt: number } | null = null;
const TOKEN_ENDPOINT = "https://zoom.us/oauth/token";

interface ZoomTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

/**
 * Zoom Server-to-Server OAuth (developers.zoom.us) — the officially
 * supported way to call Zoom's REST API (meeting lookup, cloud recording
 * download) without a per-user OAuth flow. Cached in-process until shortly
 * before expiry so we don't hit Zoom's token endpoint per call.
 */
export async function getZoomAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;

  const accountId = process.env.ZOOM_ACCOUNT_ID;
  const clientId = process.env.ZOOM_CLIENT_ID;
  const clientSecret = process.env.ZOOM_CLIENT_SECRET;
  if (!accountId || !clientId || !clientSecret) {
    throw new Error(
      "ZOOM_ACCOUNT_ID / ZOOM_CLIENT_ID / ZOOM_CLIENT_SECRET are not configured — Zoom Server-to-Server OAuth app credentials are required.",
    );
  }

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const url = `${TOKEN_ENDPOINT}?grant_type=account_credentials&account_id=${accountId}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Basic ${basicAuth}` },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    logger.error({ status: res.status, body }, "Zoom OAuth token request failed");
    throw new Error(`Zoom OAuth token request failed with status ${res.status}`);
  }

  const data = (await res.json()) as ZoomTokenResponse;
  // Refresh a little early so a request never races an expiring token.
  const ttlSeconds = Math.max(data.expires_in - 60, 60);
  cachedToken = { token: data.access_token, expiresAt: Date.now() + ttlSeconds * 1000 };

  return data.access_token;
}
