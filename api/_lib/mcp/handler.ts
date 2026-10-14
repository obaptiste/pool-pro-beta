import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isRateLimited } from '../rateLimit.js';
import { createPoolStatusMcpServer } from './server.js';
import type { McpBearerToken, PoolDataSource } from './types.js';

// Per-IP ceiling on MCP requests. One ChatGPT conversation makes a handful
// of tool calls a minute; this only bites on scripted abuse.
const RATE_LIMIT = 120;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

export interface McpHandlerOptions {
  /**
   * Builds (or returns a cached) data source. Called per request, and
   * awaited before the MCP server is connected, so a misconfigured
   * deployment — a missing/invalid service account, no owner set — fails
   * here as a clean 503 rather than reporting healthy and only failing
   * once a tool actually queries Firestore.
   */
  getSource: () => PoolDataSource | Promise<PoolDataSource>;
  /**
   * Every bearer secret this deployment accepts, each with its own scopes
   * (see McpScope) — e.g. a full read+write token for the owner's own
   * client plus a separate read-only token handed to a less-trusted
   * connector. Empty/undefined behaves like having none configured.
   */
  tokens: McpBearerToken[] | undefined;
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

// Checks every configured token rather than returning on the first match,
// so the time this takes doesn't itself hint at which token (by position)
// the presented value was compared against — the same reasoning as
// tokenMatches' own digest comparison, just extended across a list.
function matchToken(presented: string, tokens: McpBearerToken[]): McpBearerToken | null {
  let match: McpBearerToken | null = null;
  for (const candidate of tokens) {
    if (tokenMatches(presented, candidate.token)) match = candidate;
  }
  return match;
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
  if (!options.tokens || options.tokens.length === 0) {
    sendJson(res, 503, { error: 'MCP endpoint is not configured: no bearer tokens are set (MCP_BEARER_TOKEN).' });
    return;
  }

  const auth = req.headers.authorization ?? '';
  const presented = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : '';
  const matched = presented ? matchToken(presented, options.tokens) : null;
  if (!matched) {
    sendJson(res, 401, { error: 'Unauthorized: send a valid bearer token as `Authorization: Bearer <token>`.' }, { 'WWW-Authenticate': 'Bearer' });
    return;
  }

  if (isRateLimited(getClientIp(req), RATE_LIMIT, RATE_LIMIT_WINDOW_MS)) {
    sendJson(res, 429, { error: 'Too many requests — please slow down and try again shortly.' });
    return;
  }

  let source: PoolDataSource;
  try {
    source = await options.getSource();
  } catch (error) {
    sendJson(res, 503, { error: error instanceof Error ? error.message : 'MCP data source is not configured.' });
    return;
  }

  const server = createPoolStatusMcpServer(source, matched.scopes);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}
