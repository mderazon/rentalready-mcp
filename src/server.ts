import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AuthProps } from "./auth/types";
import type { ProcessedSpec } from "./spec-processor";
import { searchSpec } from "./search";
import { callApi } from "./rentalready-api";

/**
 * Creates an McpServer instance with the search and execute tools registered.
 */
export function createServer(
  props: AuthProps,
  env: Env,
  spec: ProcessedSpec,
  domains: string[]
): McpServer {
  const server = new McpServer(
    { name: "rentalready", version: "1.0.0" },
    {
      instructions:
        "RentalReady PMS API. Use the search tool to find API endpoints, then use execute to call them.",
    }
  );

  const domainList = domains.join(", ");

  server.registerTool(
    "search",
    {
      title: "Search RentalReady API",
      description: `Search the RentalReady PMS API to find endpoints.

Available domains: ${domainList}

Input a query describing what you want to do. Returns matching API endpoints with methods, paths, parameters, and schemas.

Examples:
- "list reservations"
- "create a pricing rule"
- "update rental amenities"
- "delete a mission"
- "guest registration"
- "conversations messages"`,
      inputSchema: {
        query: z
          .string()
          .describe(
            "Search query - describe what API operation you need"
          ),
      },
    },
    async ({ query }) => {
      const results = searchSpec(spec, query);
      return {
        content: [{ type: "text" as const, text: results }],
      };
    }
  );

  server.registerTool(
    "execute",
    {
      title: "Execute RentalReady API Call",
      description: `Execute an API call against the RentalReady PMS API.

Use the 'search' tool first to find the right endpoint, then call this tool.
The path should come directly from search results (e.g. /api/v3/reservations/).
Path parameters like {id} must be substituted with actual values.`,
      inputSchema: {
        method: z
          .enum(["GET", "POST", "PUT", "PATCH", "DELETE"])
          .describe("HTTP method"),
        path: z
          .string()
          .describe(
            "API path, e.g. /api/v3/reservations/ or /api/v3/rentals/123/"
          ),
        query: z
          .record(z.string(), z.string())
          .optional()
          .describe("Query parameters as key-value pairs"),
        body: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Request body as JSON object"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: true,
      },
    },
    async ({ method, path, query, body }) => {
      // Validate the path is a RentalReady API path
      if (!path.startsWith("/api/")) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Error: path must start with /api/. Use the search tool to find valid endpoints.",
            },
          ],
          isError: true,
        };
      }

      const result = await callApi(
        props,
        env,
        method,
        path,
        query as Record<string, string> | undefined,
        body as Record<string, unknown> | undefined
      );

      const text = result.ok
        ? result.body
        : `HTTP ${result.status}\n${result.body}`;

      return {
        content: [{ type: "text" as const, text }],
        isError: !result.ok,
      };
    }
  );

  return server;
}
