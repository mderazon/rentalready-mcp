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
export async function callApi(
  props: AuthProps,
  env: Env,
  method: string,
  path: string,
  query?: Record<string, string>,
  body?: Record<string, unknown>
): Promise<ApiResult> {
  let result = await makeRequest(props.accessToken, env, method, path, query, body);

  // If unauthorized, try refreshing the token and retry once
  if (result.status === 401 && props.refreshToken) {
    const refreshed = await refreshAccessToken(props, env);
    if (refreshed) {
      // Update props in place so the caller sees the new token
      props.accessToken = refreshed.accessToken;
      props.expiresAt = refreshed.expiresAt;
      if (refreshed.refreshToken) {
        props.refreshToken = refreshed.refreshToken;
      }
      result = await makeRequest(props.accessToken, env, method, path, query, body);
    }
  }

  return {
    ok: result.status >= 200 && result.status < 300,
    status: result.status,
    body: truncateResponse(result.data),
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
    data = await response.text();
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
