import type { AuthProps } from "./auth/types";
import { truncateResponse } from "./truncate";

const RENTALREADY_TOKEN_URL = "https://pms.rentalready.io/o/token/";

export interface ApiResult {
  ok: boolean;
  status: number;
  body: string;
}

/**
 * Make an authenticated API call to RentalReady using the user's tokens.
 * Automatically refreshes the access token on 401.
 */
// Arrays of objects where every item only has a "picture" key — not useful for LLMs
const PHOTO_FIELDS = new Set(["images", "listing_photos", "pictures", "photos"]);

function stripPhotos(data: unknown): unknown {
  if (Array.isArray(data)) {
    return data.map(stripPhotos);
  }
  if (data !== null && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (PHOTO_FIELDS.has(key) && Array.isArray(value)) {
        // Drop the array entirely
        continue;
      }
      result[key] = stripPhotos(value);
    }
    return result;
  }
  return data;
}

export async function callApi(
  props: AuthProps,
  env: Env,
  method: string,
  path: string,
  query?: Record<string, string>,
  body?: Record<string, unknown>
): Promise<ApiResult> {
  // Inject defaults for GET list endpoints to keep responses manageable and recent-first
  if (method === "GET") {
    if (!query?.limit) query = { ...query, limit: "10" };
    if (!query?.ordering) query = { ...query, ordering: "-id" };
  }

  let result = await makeRequest(props.accessToken, env, method, path, query, body);

  // If unauthorized, try refreshing the token and retry once.
  // Mutate props in place so that other tool calls within the same batch request
  // reuse the refreshed token instead of triggering redundant refreshes.
  // These changes are scoped to the current request — durable refresh across
  // requests is handled by tokenExchangeCallback.
  if (result.status === 401 && props.refreshToken) {
    const refreshed = await refreshAccessToken(props, env);
    if (refreshed) {
      props.accessToken = refreshed.accessToken;
      props.expiresAt = refreshed.expiresAt;
      if (refreshed.refreshToken) {
        props.refreshToken = refreshed.refreshToken;
      }
      result = await makeRequest(props.accessToken, env, method, path, query, body);
    }
  }

  const cleaned = stripPhotos(result.data);
  // Strip the base URL from next/previous pagination URLs so the LLM can use
  // them directly as paths in execute_read (e.g. "/api/v3/reservations/?offset=10")
  const responseBody = truncateResponse(cleaned).replaceAll(env.RENTALREADY_API_BASE, "");
  return {
    ok: result.status >= 200 && result.status < 300,
    status: result.status,
    body: responseBody,
  };
}

async function makeRequest(
  accessToken: string,
  env: Env,
  method: string,
  path: string,
  query?: Record<string, string>,
  body?: Record<string, unknown>
): Promise<{ status: number; data: unknown }> {
  const url = new URL(path, env.RENTALREADY_API_BASE);
  if (url.origin !== new URL(env.RENTALREADY_API_BASE).origin) {
    return { status: 400, data: "Invalid API path: must target RentalReady API" };
  }

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
  };

  let requestBody: string | undefined;
  if (body && method !== "GET") {
    headers["Content-Type"] = "application/json";
    requestBody = JSON.stringify(body);
  }

  const response = await fetch(url.toString(), {
    method,
    headers,
    body: requestBody,
  });

  let data: unknown;
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    data = await response.json();
  } else {
    const text = await response.text();
    // Don't pass raw HTML to the LLM — return a clean error instead
    if (contentType.includes("text/html") || text.trimStart().startsWith("<!")) {
      data = `HTTP ${response.status} ${response.statusText || "Error"} (server returned HTML instead of JSON)`;
    } else {
      data = text;
    }
  }

  return { status: response.status, data };
}

async function refreshAccessToken(
  props: AuthProps,
  _env: Env
): Promise<{
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
} | null> {
  try {
    const response = await fetch(RENTALREADY_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: props.refreshToken,
        client_id: _env.RENTALREADY_CLIENT_ID,
        client_secret: _env.RENTALREADY_CLIENT_SECRET,
      }),
    });

    if (!response.ok) return null;

    const data = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Math.floor(Date.now() / 1000) + data.expires_in,
    };
  } catch {
    return null;
  }
}
