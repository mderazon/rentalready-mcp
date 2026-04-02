import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createAuthHandler, handleTokenExchange } from "./auth/handler";
import type { AuthProps } from "./auth/types";
import { processSpec, extractDomains } from "./spec-processor";
import type { ProcessedSpec } from "./spec-processor";
import { createServer } from "./server";

// In-memory cache for the processed spec (lives for the Worker instance lifetime)
let cachedSpec: ProcessedSpec | null = null;
let cachedDomains: string[] | null = null;

async function loadSpec(env: Env): Promise<{ spec: ProcessedSpec; domains: string[] }> {
  if (cachedSpec && cachedDomains) {
    return { spec: cachedSpec, domains: cachedDomains };
  }

  const [specObj, domainsObj] = await Promise.all([
    env.SPEC_BUCKET.get("spec.json"),
    env.SPEC_BUCKET.get("domains.json"),
  ]);

  if (!specObj || !domainsObj) {
    throw new Error(
      "OpenAPI spec not found in R2. Run the scheduled handler first to seed the spec."
    );
  }

  cachedSpec = (await specObj.json()) as ProcessedSpec;
  cachedDomains = (await domainsObj.json()) as string[];

  return { spec: cachedSpec, domains: cachedDomains };
}

/**
 * MCP request handler: creates a new McpServer + transport per request (stateless).
 */
const mcpHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Extract props from the execution context (set by OAuthProvider)
    const props = (ctx as unknown as { props: AuthProps }).props;

    if (!props?.accessToken) {
      return new Response("Unauthorized", { status: 401 });
    }

    const { spec, domains } = await loadSpec(env);
    const server = createServer(props, env, spec, domains);

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless mode
      enableJsonResponse: true,
    });

    await server.connect(transport);

    return transport.handleRequest(request, {
      authInfo: {
        token: props.accessToken,
        clientId: "rentalready-mcp",
        scopes: [],
      },
    });
  },
};

/**
 * The OAuthProvider wraps everything:
 * - /mcp → authenticated MCP handler
 * - /authorize, /callback → RentalReady OAuth proxy
 * - /token, /register → OAuth provider endpoints
 */
const oauthProvider = new OAuthProvider<Env>({
  apiRoute: "/mcp",
  apiHandler: mcpHandler,
  // defaultHandler receives non-API requests (authorize, callback, etc.)
  // OAuthProvider auto-injects env.OAUTH_PROVIDER with OAuthHelpers
  defaultHandler: {
    fetch: async (request: Request, env: Env, ctx: ExecutionContext) => {
      const authApp = createAuthHandler();
      return authApp.fetch(request, env as never, ctx);
    },
  },
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
  accessTokenTTL: 1800, // 30 minutes
  refreshTokenTTL: 2592000, // 30 days
  tokenExchangeCallback: handleTokenExchange,
});

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    return oauthProvider.fetch(request, env, ctx);
  },

  async scheduled(
    _controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<void> {
    console.log("Fetching RentalReady OpenAPI spec...");

    const response = await fetch(env.OPENAPI_SPEC_URL);
    if (!response.ok) {
      console.error(`Failed to fetch spec: ${response.status}`);
      return;
    }

    const yamlText = await response.text();
    console.log(`Spec fetched (${yamlText.length} bytes), processing...`);

    const spec = processSpec(yamlText);
    const domains = extractDomains(yamlText);

    await Promise.all([
      env.SPEC_BUCKET.put("spec.json", JSON.stringify(spec)),
      env.SPEC_BUCKET.put("domains.json", JSON.stringify(domains)),
    ]);

    // Clear in-memory cache so next request loads fresh data
    cachedSpec = null;
    cachedDomains = null;

    console.log(
      `Spec processed and stored. ${Object.keys(spec.paths).length} paths, ${domains.length} domains.`
    );
  },
};
