// Runs scripts/agent (the Bash control CLI over TASKS.md) against a fixture
// backlog. scripts/agent is kept byte-identical with the copy in the
// Cronx-Academy repo, so these cases mirror that repo's Vitest suite.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const SCRIPT = path.join(HERE, 'agent');
const FIXTURE = path.join(HERE, 'fixtures/TASKS.fixture.md');

let tmp: string;

function agent(args: string[], tasksFile: string = FIXTURE) {
  const result = spawnSync('bash', [SCRIPT, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      AGENT_TASKS_FILE: tasksFile,
      AGENT_LOG_DIR: path.join(tmp, 'logs'),
    },
  });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

const ranked = (out: string) => out.split('\n').filter((line) => line.startsWith('['));

beforeEach(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'agent-cli-'));
});

describe('scripts/agent', () => {
  it('next prints the P1 item even though it comes after P2 items in the file', () => {
    const { code, out } = agent(['next']);
    assert.equal(code, 0);
    assert.equal(out.split('\n')[0], '[1] P1 — Top priority item');
  });

  it('list orders P1, P2 (file order), P3 and numbers them from 1', () => {
    const { code, out } = agent(['list']);
    assert.equal(code, 0);
    assert.deepEqual(ranked(out), [
      '[1] P1 — Top priority item',
      '[2] P2 — Second-tier alpha',
      '[3] P2 — Second-tier beta',
      '[4] P3 — Low priority item',
    ]);
  });

  it('list P2 shows only P2 items', () => {
    assert.deepEqual(ranked(agent(['list', 'P2']).out), [
      '[2] P2 — Second-tier alpha',
      '[3] P2 — Second-tier beta',
    ]);
  });

  it('done items in either case are never listed', () => {
    const { code, out } = agent(['list']);
    assert.equal(code, 0);
    assert.ok(!out.includes('Already done'));
  });

  it('blocked item is absent from the ranked list and present under Blocked with its reason', () => {
    const lines = agent(['list']).out.split('\n');
    assert.ok(!ranked(lines.join('\n')).join('\n').includes('Waiting on keys'));
    const blockedAt = lines.indexOf('Blocked:');
    assert.ok(blockedAt > -1);
    assert.equal(lines[blockedAt + 1].trim(), 'P2 — Waiting on keys (blocked: waiting on keys)');
  });

  it('items without a leading priority token appear under Unparsed, not ranked', () => {
    const { out } = agent(['list']);
    const lines = out.split('\n');
    const unparsedAt = lines.indexOf('Unparsed:');
    assert.ok(unparsedAt > -1);
    const unparsed = lines.slice(unparsedAt + 1).join('\n');
    assert.ok(unparsed.includes('No priority token on this one at all.'));
    assert.ok(unparsed.includes('Mentions P1 mid-sentence'));
    assert.equal(ranked(out).length, 4);
  });

  it('continuation lines are part of the item detail in next', () => {
    assert.ok(agent(['next']).out.includes('pineapple'));
  });

  it('start 2 prints the second ranked item, the reading pointer, and both verification commands', () => {
    const { code, out } = agent(['start', '2']);
    assert.equal(code, 0);
    assert.ok(out.includes('P2 — Second-tier alpha'));
    assert.ok(out.includes('First P2 in file order.'));
    assert.ok(out.includes('Read first: CLAUDE.md'));
    assert.ok(out.includes('npm run lint'));
    assert.ok(out.includes('npm test'));
    assert.ok(!out.includes('Top priority item'));
  });

  for (const extra of [[], ['abc'], ['0'], ['99']]) {
    it(`start with bad task number ${JSON.stringify(extra)} exits 1 with a usage line`, () => {
      const { code, out, err } = agent(['start', ...extra]);
      assert.equal(code, 1);
      assert.ok(err.includes('Usage: scripts/agent start <n>'));
      assert.ok(!out.includes('Read first'));
    });
  }

  it('a CRLF copy of the fixture yields the same list output', () => {
    const crlf = path.join(tmp, 'TASKS.crlf.md');
    writeFileSync(crlf, readFileSync(FIXTURE, 'utf8').replace(/\n/g, '\r\n'));
    const fromCrlf = agent(['list'], crlf);
    assert.equal(fromCrlf.code, 0);
    assert.equal(fromCrlf.out, agent(['list']).out);
    assert.ok(!fromCrlf.out.includes('\r'));
  });

  it('a backlog with only done items makes next print "No open tasks." and exit 0', () => {
    const done = path.join(tmp, 'TASKS.done.md');
    writeFileSync(done, '- [x] **P1 — Done.** Finished.\n- [X] **P2 — Also done.**\n');
    const { code, out } = agent(['next'], done);
    assert.equal(code, 0);
    assert.equal(out.trim(), 'No open tasks.');
  });

  it('missing backlog exits 1 and names the path', () => {
    const missing = path.join(tmp, 'nope.md');
    const { code, err } = agent(['next'], missing);
    assert.equal(code, 1);
    assert.ok(err.includes(`No backlog found at ${missing}`));
  });

  it('log appends a timestamped line and writes shell syntax literally', () => {
    const note = 'ran $(echo hi) and `whoami` with "quotes"';
    assert.equal(agent(['log', note]).code, 0);
    assert.equal(agent(['log', 'second note']).code, 0);
    const logDir = path.join(tmp, 'logs');
    const files = readdirSync(logDir);
    assert.equal(files.length, 1);
    assert.match(files[0], /^session-\d{4}-\d{2}-\d{2}\.md$/);
    const lines = readFileSync(path.join(logDir, files[0]), 'utf8').trim().split('\n');
    assert.equal(lines.length, 2);
    assert.match(lines[0], /^- \d{2}:\d{2}:\d{2} /);
    assert.ok(lines[0].endsWith(note));
    assert.ok(lines[1].endsWith('second note'));
  });

  it('log without a note exits 1 with a usage line', () => {
    const { code, err } = agent(['log']);
    assert.equal(code, 1);
    assert.ok(err.includes('Usage: scripts/agent log'));
  });

  it('status reports branch, dirty count, task counts, and last log', () => {
    const { code, out } = agent(['status']);
    assert.equal(code, 0);
    const lines = out.trim().split('\n');
    assert.match(lines[0], /^Branch: \S+/);
    assert.match(lines[1], /^Dirty files: \d+$/);
    assert.equal(lines[2], 'Open: 4  Blocked: 1  Unparsed: 2');
    assert.equal(lines[3], 'Last log: none');
  });

  it('unknown subcommand exits 1; help and no arguments exit 0', () => {
    assert.equal(agent(['frobnicate']).code, 1);
    assert.equal(agent(['help']).code, 0);
    assert.equal(agent([]).code, 0);
    assert.ok(agent(['help']).out.includes('Usage: scripts/agent'));
  });
});
