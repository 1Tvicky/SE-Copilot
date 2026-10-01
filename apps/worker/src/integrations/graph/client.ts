/**
 * Minimal Microsoft Graph client for the app-only (client credentials) flow.
 * SE Copilot reads the team mailbox calendar and sends mail as the team, so
 * it authenticates as the application, not as a signed-in user. Access is
 * scoped to the right mailboxes with an Exchange Application Access Policy /
 * RBAC for Applications — see docs/setup/microsoft-365.md.
 */

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

export class GraphError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message);
    this.name = "GraphError";
  }
}

export function isGraphConfigured(): boolean {
  return Boolean(process.env.MICROSOFT_TENANT_ID && process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET);
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAppToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt - 60_000 > Date.now()) return cachedToken.token;
  if (!isGraphConfigured()) throw new GraphError("Microsoft Graph is not configured (MICROSOFT_TENANT_ID / CLIENT_ID / CLIENT_SECRET)", 0, "not_configured");

  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(process.env.MICROSOFT_TENANT_ID!)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.MICROSOFT_CLIENT_ID!,
      client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || !body.access_token) {
    throw new GraphError(`Graph token request failed: ${body.error_description ?? body.error ?? res.statusText}`, res.status, body.error ?? null);
  }
  cachedToken = { token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return cachedToken.token;
}

export interface GraphRequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
}

/**
 * Calls Graph with the app token. `pathOrUrl` is either a path relative to
 * /v1.0 or an absolute @odata.nextLink. Retries 429/503/504 honouring
 * Retry-After (Graph throttles mailbox APIs per app per mailbox).
 */
export async function graphRequest<T>(pathOrUrl: string, options: GraphRequestOptions = {}): Promise<T> {
  const url = pathOrUrl.startsWith("https://") ? pathOrUrl : `${GRAPH_BASE}${pathOrUrl}`;
  for (let attempt = 0; ; attempt++) {
    const token = await getAppToken();
    const res = await fetch(url, {
      method: options.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

    if ((res.status === 429 || res.status === 503 || res.status === 504) && attempt < 3) {
      const retryAfter = Number(res.headers.get("retry-after"));
      await new Promise((r) => setTimeout(r, (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 2 ** attempt * 2) * 1000));
      continue;
    }
    if (res.status === 401 && attempt === 0) {
      cachedToken = null;
      continue;
    }
    if (!res.ok) {
      const err = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
      throw new GraphError(`Graph ${options.method ?? "GET"} ${new URL(url).pathname} failed (${res.status}): ${err?.error?.message ?? res.statusText}`, res.status, err?.error?.code ?? null);
    }
    if (res.status === 202 || res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }
}

/** Follows @odata.nextLink until exhausted. */
export async function graphPaginate<T>(path: string, headers?: Record<string, string>, maxPages = 50): Promise<T[]> {
  const items: T[] = [];
  let next: string | undefined = path;
  for (let page = 0; next && page < maxPages; page++) {
    const res: { value: T[]; "@odata.nextLink"?: string } = await graphRequest(next, { headers });
    items.push(...res.value);
    next = res["@odata.nextLink"];
  }
  return items;
}
