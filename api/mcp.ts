import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleMcpRequest } from './_lib/mcp/handler.js';
import { createFirestoreSource } from './_lib/mcp/firestoreSource.js';
import type { McpBearerToken } from './_lib/mcp/types.js';

// Remote MCP endpoint (Streamable HTTP, stateless) exposing PoolStatus data
// to MCP clients such as ChatGPT or Claude. See api/_lib/mcp/ for the
// tools; configuration is via env vars documented in .env.example:
// MCP_BEARER_TOKEN (full read+write access), optionally
// MCP_READONLY_BEARER_TOKEN (read-only — hand this to a less-trusted
// connector instead of the full token), FIREBASE_SERVICE_ACCOUNT, and
// POOLSTATUS_OWNER_UID (or POOLSTATUS_OWNER_EMAIL).
// MCP_BEARER_TOKEN is what "enables the endpoint" per .env.example/docs — if
// it's unset, the endpoint must 503 regardless of whether a leftover
// MCP_READONLY_BEARER_TOKEN is still set, otherwise a deployer who removes
// the primary token (e.g. to disable MCP entirely) would be surprised to
// find pool data still readable through the forgotten read-only credential.
export function configuredTokens(): McpBearerToken[] {
  const bearer = process.env.MCP_BEARER_TOKEN;
  if (!bearer) return [];
  const tokens: McpBearerToken[] = [{ token: bearer, scopes: ['read', 'write'] }];
  if (process.env.MCP_READONLY_BEARER_TOKEN) {
    tokens.push({ token: process.env.MCP_READONLY_BEARER_TOKEN, scopes: ['read'] });
  }
  return tokens;
}

let sourcePromise: ReturnType<typeof createFirestoreSource> | undefined;

export default async function handler(req: IncomingMessage & { body?: unknown }, res: ServerResponse) {
  await handleMcpRequest(req, res, {
    tokens: configuredTokens(),
    getSource: async () => {
      sourcePromise ??= createFirestoreSource();
      try {
        return await sourcePromise;
      } catch (error) {
        // Don't cache a failure forever — a transient issue (e.g. the
        // owner-email lookup's network call) should be retried on the
        // next request rather than 503ing until the instance recycles.
        sourcePromise = undefined;
        throw error;
      }
    },
  });
}
