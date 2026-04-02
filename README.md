# RentalReady MCP Server

A token-efficient **Model Context Protocol (MCP)** server that wraps the RentalReady Property Management System (PMS) API. It enables AI agents (like Claude Desktop) to interact with RentalReady via natural language.

Built on **Cloudflare Workers**, this server implements a lightweight "Code Mode" pattern combining `search` and `execute` tools. This solves the heavy context window costs of native REST API mappings (turning a ~1.17M token API into ~1K tokens).


## Getting Started

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
