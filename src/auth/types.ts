/**
 * Props stored encrypted by @cloudflare/workers-oauth-provider.
 * Passed via `props` on each MCP request.
 * Each user has their own set of RentalReady tokens.
 */
export interface AuthProps {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp (seconds)
  userId: string;
  email: string;
}
