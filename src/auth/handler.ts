import { Hono } from "hono";
import type { OAuthHelpers, AuthRequest } from "@cloudflare/workers-oauth-provider";
import type { AuthProps } from "./types";

// RentalReady OAuth endpoints
const RENTALREADY_AUTHORIZE_URL =
  "https://pms.rentalready.io/o/authorize/";
const RENTALREADY_TOKEN_URL = "https://pms.rentalready.io/o/token/";

// All scopes we request from RentalReady
const RENTALREADY_SCOPES = [
  "read",
  "write",
  "amenities:read",
  "reservations:read",
  "reservations:write",
  "reviews:read",
  "reviews:write",
  "hosts:read",
  "hosts:write",
  "offices:read",
  "onboarding_requests:read",
  "listing_requests:read",
  "pricing:read",
  "pricing:write",
  "users:read",
  "calendar:read",
  "calendar:write",
  "rentals:read",
  "rentals:write",
  "issues:read",
  "issues:write",
  "missions:read",
  "missions:write",
].join(" ");

type HonoEnv = {
  Bindings: Env & { OAUTH_PROVIDER: OAuthHelpers };
};

export function createAuthHandler() {
  const app = new Hono<HonoEnv>();

  /**
   * GET /authorize — MCP client initiates OAuth.
   * We parse the MCP request, then redirect the user to RentalReady's OAuth.
   */
  app.get("/authorize", async (c) => {
    let oauthReqInfo;
    try {
      oauthReqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Invalid OAuth request";
      return c.text(`Bad Request: ${msg}`, 400);
    }

    // Encode MCP OAuth request info in state so we can recover it in /callback
    const state = btoa(JSON.stringify(oauthReqInfo));

    const callbackUrl = new URL("/callback", c.req.url).toString();

    const params = new URLSearchParams({
      response_type: "code",
      client_id: c.env.RENTALREADY_CLIENT_ID,
      redirect_uri: callbackUrl,
      scope: RENTALREADY_SCOPES,
      state,
      access_type: "offline",
    });

    return c.redirect(`${RENTALREADY_AUTHORIZE_URL}?${params.toString()}`);
  });

  /**
   * GET /callback — RentalReady redirects here after user authenticates.
   * We exchange the auth code for tokens, then complete the MCP OAuth flow.
   */
  app.get("/callback", async (c) => {
    const code = c.req.query("code");
    const stateParam = c.req.query("state");

    if (!code || !stateParam) {
      return c.text("Missing code or state parameter", 400);
    }

    // Recover the original MCP OAuth request
    let oauthReqInfo: AuthRequest;
    try {
      oauthReqInfo = JSON.parse(atob(stateParam));
    } catch {
      return c.text("Invalid state parameter", 400);
    }

    const callbackUrl = new URL("/callback", c.req.url).toString();

    // Exchange authorization code for tokens
    const tokenResponse = await fetch(RENTALREADY_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: c.env.RENTALREADY_CLIENT_ID,
        client_secret: c.env.RENTALREADY_CLIENT_SECRET,
        code,
        redirect_uri: callbackUrl,
      }),
    });

    if (!tokenResponse.ok) {
      const error = await tokenResponse.text();
      return c.text(`Token exchange failed: ${error}`, 502);
    }

    const tokenData = (await tokenResponse.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    // Try to get user info from RentalReady
    const userInfo = await fetchUserInfo(tokenData.access_token);

    const props: AuthProps = {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: Math.floor(Date.now() / 1000) + tokenData.expires_in,
      userId: userInfo.id,
      email: userInfo.email,
    };

    // Complete the MCP OAuth authorization
    const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
      request: oauthReqInfo,
      userId: userInfo.id,
      metadata: { email: userInfo.email },
      scope: oauthReqInfo.scope,
      props,
    });

    return c.redirect(redirectTo);
  });

  return app;
}

async function fetchUserInfo(
  accessToken: string
): Promise<{ id: string; email: string }> {
  // Try RentalReady users endpoint
  const response = await fetch(
    "https://pms.rentalready.io/api/v3/users/me/",
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (response.ok) {
    const data = (await response.json()) as {
      id?: number;
      email?: string;
      username?: string;
    };
    return {
      id: String(data.id ?? "unknown"),
      email: data.email ?? data.username ?? "unknown",
    };
  }

  // Fallback: use a hash of the token as user ID
  return { id: "user", email: "unknown" };
}

/**
 * Token exchange callback: refresh RentalReady tokens when they're near expiry.
 * Called by OAuthProvider when the MCP client refreshes its token.
 */
export async function handleTokenExchange(
  options: {
    grantType: string;
    props: AuthProps;
    clientId: string;
    userId: string;
    scope: string[];
    requestedScope: string[];
  },
  env: Env
): Promise<{ newProps?: AuthProps; accessTokenTTL?: number } | void> {
  if (options.grantType !== "refresh_token") return undefined;

  const { props } = options;
  const now = Math.floor(Date.now() / 1000);

  // If RentalReady token expires in less than 5 minutes, proactively refresh it
  if (props.expiresAt - now < 300 && props.refreshToken) {
    const tokenResponse = await fetch(RENTALREADY_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: props.refreshToken,
        client_id: env.RENTALREADY_CLIENT_ID,
        client_secret: env.RENTALREADY_CLIENT_SECRET,
      }),
    });

    if (tokenResponse.ok) {
      const tokenData = (await tokenResponse.json()) as {
        access_token: string;
        refresh_token?: string;
        expires_in: number;
      };

      const newProps: AuthProps = {
        ...props,
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token ?? props.refreshToken,
        expiresAt: now + tokenData.expires_in,
      };

      return {
        newProps,
        // Match the MCP token's lifetime exactly to the newly refreshed RentalReady token's lifetime
        accessTokenTTL: tokenData.expires_in, 
      };
    }
  }

  return undefined;
}
