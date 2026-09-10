import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleMcpRequest } from './_lib/mcp/handler';
import { createFirestoreSource } from './_lib/mcp/firestoreSource';

// Remote MCP endpoint (Streamable HTTP, stateless) exposing read-only
// PoolStatus data to MCP clients such as ChatGPT or Claude. See
// api/_lib/mcp/ for the tools; configuration is via env vars documented
// in .env.example: MCP_BEARER_TOKEN, FIREBASE_SERVICE_ACCOUNT, and
// POOLSTATUS_OWNER_UID (or POOLSTATUS_OWNER_EMAIL).
let sourcePromise: ReturnType<typeof createFirestoreSource> | undefined;

export default async function handler(req: IncomingMessage & { body?: unknown }, res: ServerResponse) {
  await handleMcpRequest(req, res, {
    bearerToken: process.env.MCP_BEARER_TOKEN,
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
