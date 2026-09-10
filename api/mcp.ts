import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleMcpRequest } from './_lib/mcp/handler';
import { createFirestoreSource } from './_lib/mcp/firestoreSource';

// Remote MCP endpoint (Streamable HTTP, stateless) exposing read-only
// PoolStatus data to MCP clients such as ChatGPT or Claude. See
// api/_lib/mcp/ for the tools; configuration is via env vars:
//   MCP_BEARER_TOKEN          shared secret clients must present
//   FIREBASE_SERVICE_ACCOUNT  service-account JSON (raw or base64)
//   POOLSTATUS_OWNER_UID      (or POOLSTATUS_OWNER_EMAIL) whose data to expose
let source: ReturnType<typeof createFirestoreSource> | undefined;

export default async function handler(req: IncomingMessage & { body?: unknown }, res: ServerResponse) {
  await handleMcpRequest(req, res, {
    bearerToken: process.env.MCP_BEARER_TOKEN,
    getSource: () => (source ??= createFirestoreSource()),
  });
}
