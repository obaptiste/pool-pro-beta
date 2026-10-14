import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { configuredTokens } from './mcp.js';

const ORIGINAL_BEARER = process.env.MCP_BEARER_TOKEN;
const ORIGINAL_READONLY = process.env.MCP_READONLY_BEARER_TOKEN;

afterEach(() => {
  if (ORIGINAL_BEARER === undefined) delete process.env.MCP_BEARER_TOKEN;
  else process.env.MCP_BEARER_TOKEN = ORIGINAL_BEARER;
  if (ORIGINAL_READONLY === undefined) delete process.env.MCP_READONLY_BEARER_TOKEN;
  else process.env.MCP_READONLY_BEARER_TOKEN = ORIGINAL_READONLY;
});

describe('configuredTokens', () => {
  it('returns no tokens when neither env var is set', () => {
    delete process.env.MCP_BEARER_TOKEN;
    delete process.env.MCP_READONLY_BEARER_TOKEN;
    assert.deepEqual(configuredTokens(), []);
  });

  it('returns a full read+write token when only MCP_BEARER_TOKEN is set', () => {
    process.env.MCP_BEARER_TOKEN = 'full-token';
    delete process.env.MCP_READONLY_BEARER_TOKEN;
    assert.deepEqual(configuredTokens(), [{ token: 'full-token', scopes: ['read', 'write'] }]);
  });

  it('returns both tokens, correctly scoped, when both env vars are set', () => {
    process.env.MCP_BEARER_TOKEN = 'full-token';
    process.env.MCP_READONLY_BEARER_TOKEN = 'ro-token';
    assert.deepEqual(configuredTokens(), [
      { token: 'full-token', scopes: ['read', 'write'] },
      { token: 'ro-token', scopes: ['read'] },
    ]);
  });

  it('returns no tokens — not just the read-only one — when MCP_BEARER_TOKEN is unset but MCP_READONLY_BEARER_TOKEN is still set', () => {
    // Regression: a deployer removing the primary token (e.g. to disable
    // MCP entirely) must actually disable the endpoint, not leave it live
    // through a forgotten read-only credential.
    delete process.env.MCP_BEARER_TOKEN;
    process.env.MCP_READONLY_BEARER_TOKEN = 'ro-token';
    assert.deepEqual(configuredTokens(), []);
  });
});
