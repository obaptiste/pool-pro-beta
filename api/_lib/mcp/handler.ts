import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isRateLimited } from '../rateLimit';
import { createPoolStatusMcpServer } from './server';
import type { PoolDataSource } from './types';

// Per-IP ceiling on MCP requests. One ChatGPT conversation makes a handful
// of tool calls a minute; this only bites on scripted abuse.
const RATE_LIMIT = 120;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

export interface McpHandlerOptions {
  /** Builds (or returns a cached) data source. Called per request so a misconfiguration surfaces as a 503, not a crash at import. */
  getSource: () => PoolDataSource;
  /** The shared secret a client must present as `Authorization: Bearer <token>`. */
  bearerToken: string | undefined;
}

type NodeRequest = IncomingMessage & { body?: unknown };

function getClientIp(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return value?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
}

// Compare digests rather than the raw strings so the comparison is
// constant-time regardless of how the presented token's length differs.
function tokenMatches(presented: string, expected: string): boolean {
  const a = createHash('sha256').update(presented).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

/**
 * Streamable-HTTP MCP endpoint, stateless: every request gets a fresh
 * server + transport, so it runs identically as a Vercel function and
 * mounted on the Express dev server. Only POST carries JSON-RPC; the
 * transport itself rejects GET/DELETE (which only matter for sessions).
 */
export async function handleMcpRequest(req: NodeRequest, res: ServerResponse, options: McpHandlerOptions): Promise<void> {
  if (!options.bearerToken) {
    sendJson(res, 503, { error: 'MCP endpoint is not configured: MCP_BEARER_TOKEN is not set.' });
    return;
  }

  const auth = req.headers.authorization ?? '';
  const presented = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : '';
  if (!presented || !tokenMatches(presented, options.bearerToken)) {
    sendJson(res, 401, { error: 'Unauthorized: send a valid MCP_BEARER_TOKEN as `Authorization: Bearer <token>`.' }, { 'WWW-Authenticate': 'Bearer' });
    return;
  }

  if (isRateLimited(getClientIp(req), RATE_LIMIT, RATE_LIMIT_WINDOW_MS)) {
    sendJson(res, 429, { error: 'Too many requests — please slow down and try again shortly.' });
    return;
  }

  let source: PoolDataSource;
  try {
    source = options.getSource();
  } catch (error) {
    sendJson(res, 503, { error: error instanceof Error ? error.message : 'MCP data source is not configured.' });
    return;
  }

  const server = createPoolStatusMcpServer(source);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}
