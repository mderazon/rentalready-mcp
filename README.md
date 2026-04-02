# RentalReady MCP Server

A token-efficient **Model Context Protocol (MCP)** server that wraps the RentalReady Property Management System (PMS) API. It enables AI agents (like Claude Desktop or Claude Code) to interact with RentalReady via natural language.

Built on **Cloudflare Workers**, this server implements a lightweight "Code Mode" pattern combining `search` and `execute` tools. This solves the heavy context window costs of native REST API mappings (turning a ~1.17M token API into ~1K tokens).

> *Read the original architecture inspiration: **[Code Mode MCP by Cloudflare](https://blog.cloudflare.com/code-mode-mcp/)***


## Getting Started (For End Users)

You can easily plug this server into your Claude Desktop app or the Claude CLI (Claude Code) by adding it as an SSE (Server-Sent Events) MCP Server.

### Claude Desktop
Add the following to your `claude_desktop_config.json` file:

```json
{
  "mcpServers": {
    "rentalready": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/create-server",
        "--type",
        "sse",
        "--url",
        "https://rentalready-mcp.treeview.dev/mcp"
      ]
    }
  }
}
```

### Claude.ai Web UI (Custom Connectors)
You can directly integrate this MCP server into Claude's Web UI via the **Custom Connectors (BETA)** feature:

1. In Claude.ai, navigate to **Settings -> Customize -> Connectors**.
2. Click **Add custom connector**.
3. Fill in the modal:
   - **Name**: `RentalReady`
   - **Remote MCP server URL**: `https://rentalready-mcp.treeview.dev/mcp`
   - **Advanced settings**: You can leave OAuth Client ID and Secret blank (the worker manages its own authentication flow).
4. Click **Add**.

*(When first making requests, you will be prompted via OAuth to grant Claude access to your RentalReady account).*


---


## Development & Deployment (For Contributors)

If you are looking to host, modify, or deploy this server yourself, use these instructions:

### Prerequisites
- Node.js & npm
- A Cloudflare account with Wrangler CLI (`npx wrangler login`)

### Setup Cloudflare Secrets
The server requires the following secrets to interact with RentalReady and secure its OAuth session states.
```bash
npx wrangler secret put RENTALREADY_CLIENT_ID
npx wrangler secret put RENTALREADY_CLIENT_SECRET
npx wrangler secret put COOKIE_ENCRYPTION_KEY
```

> For local development, create a `.dev.vars` file and define these values. 

### Local Development
To run the server locally on `http://localhost:8787/mcp`, use:
```bash
npm install
npm run dev
```

### Deployment
To bundle and deploy the worker logic, cron jobs, and custom domain to Cloudflare edge:
```bash
npm run deploy
```

*(Ensure you have provisioned the required `rentalready-spec` R2 Bucket and `OAUTH_KV` KV namespace in Cloudflare, as defined in `wrangler.jsonc`.)*
