// Runs scripts/agent (the Bash control CLI over TASKS.md) against a fixture
// backlog. scripts/agent is kept byte-identical with the copy in the
// Cronx-Academy repo, so these cases mirror that repo's Vitest suite.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
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

function backlog(name: string, content: string) {
  const file = path.join(tmp, name);
  writeFileSync(file, content);
  return file;
}

// A copy of the script in a directory that is not a git work tree and has no
// node_modules, so `status` and `check` can be exercised away from this repo.
function standalone(args: string[], env: Record<string, string> = {}) {
  const root = path.join(tmp, 'stand alone');
  mkdirSync(path.join(root, 'scripts'), { recursive: true });
  copyFileSync(SCRIPT, path.join(root, 'scripts/agent'));
  writeFileSync(path.join(root, 'TASKS.md'), '- [ ] **P1 — Only task.** Detail.\n');
  const result = spawnSync('bash', [path.join(root, 'scripts/agent'), ...args], {
    cwd: tmp,
    encoding: 'utf8',
    env: { ...process.env, AGENT_TASKS_FILE: '', AGENT_LOG_DIR: '', GIT_CEILING_DIRECTORIES: tmp, ...env },
  });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

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
    assert.equal(lines[2], 'Open: 4  Blocked: 2  Unparsed: 2');
    assert.equal(lines[3], 'Last log: none');
  });

  it('unknown subcommand exits 1; help and no arguments exit 0', () => {
    assert.equal(agent(['frobnicate']).code, 1);
    assert.equal(agent(['help']).code, 0);
    assert.equal(agent([]).code, 0);
    assert.ok(agent(['help']).out.includes('Usage: scripts/agent'));
  });

  it('a blocked tag on a continuation line blocks the item', () => {
    const { out } = agent(['list']);
    assert.ok(out.includes('  P3 — Waiting on operator (blocked: operator action)'));
    assert.ok(!ranked(out).join('\n').includes('Waiting on operator'));
    assert.equal(agent(['status']).out.trim().split('\n')[2], 'Open: 4  Blocked: 2  Unparsed: 2');
  });

  it('an upper-case [X] item is done, not open or unparsed', () => {
    const file = backlog('upper.md', '- [X] **P1 — Upper done.** x\n- [ ] **P2 — Real.** y\n');
    const { out } = agent(['list'], file);
    assert.deepEqual(ranked(out), ['[1] P2 — Real']);
    assert.ok(!out.includes('Unparsed:'));
    assert.ok(!out.includes('Upper done'));
  });

  it('malformed open checkboxes are reported as Unparsed, never dropped', () => {
    const loose = [
      '- [ ]\t**P1 — Tab after box.** x',
      '* [ ] **P1 — Star bullet.** x',
      '- [] **P1 — Empty box.** x',
      '-  [ ] **P1 — Two spaces.** x',
      '1. [ ] **P1 — Numbered.** x',
      '  - [ ] **P1 — Indented top level.** x',
    ];
    const file = backlog('loose.md', '\uFEFF- [ ] **P2 — After a BOM.** x\n\n' + loose.join('\n\n') + '\n');
    const { out } = agent(['list'], file);
    assert.deepEqual(ranked(out), ['[1] P2 — After a BOM']);
    for (const title of ['Tab after box', 'Star bullet', 'Empty box', 'Two spaces', 'Numbered', 'Indented top level']) {
      assert.ok(out.slice(out.indexOf('Unparsed:')).includes(title));
    }
    assert.equal(agent(['status'], file).out.trim().split('\n')[2], 'Open: 1  Blocked: 0  Unparsed: 6');
  });

  it('an indented sub-item stays part of its parent, and a blank line ends an item', () => {
    const file = backlog(
      'nested.md',
      '- [ ] **P1 — Parent.** Detail.\n      - [ ] nested step guava\n\n      Stray indented prose kumquat.\n'
    );
    const { out } = agent(['next'], file);
    assert.ok(out.includes('guava'));
    assert.ok(!out.includes('kumquat'));
    assert.ok(!agent(['list'], file).out.includes('Unparsed:'));
  });

  it('list rejects a filter that is not P1, P2 or P3', () => {
    for (const filter of ['P4', 'p2', 'all']) {
      const { code, err } = agent(['list', filter]);
      assert.equal(code, 1);
      assert.ok(err.includes('Usage: scripts/agent list [P1|P2|P3]'));
    }
  });

  it('start points at the agents guide when the repo has one', () => {
    assert.match(agent(['start', '1']).out, /Read first: CLAUDE\.md, A(GENTS|gents)\.md/);
  });

  it('status works outside a git work tree', () => {
    const { code, out } = standalone(['status']);
    assert.equal(code, 0);
    assert.deepEqual(out.trim().split('\n'), ['Branch: unknown', 'Dirty files: 0', 'Open: 1  Blocked: 0  Unparsed: 0', 'Last log: none']);
  });

  it('check refuses to run before dependencies are installed', () => {
    const { code, out, err } = standalone(['check']);
    assert.equal(code, 1);
    assert.ok(err.includes('Run npm install first.'));
    assert.ok(!out.includes('PASS'));
  });

  it('status reports the newest session log, ignoring files with other names', () => {
    const logDir = path.join(tmp, 'logs');
    mkdirSync(logDir, { recursive: true });
    writeFileSync(path.join(logDir, 'session_2026-06-15_12-38-05.md'), 'old format\n');
    writeFileSync(path.join(logDir, 'session-2020-01-01.md'), '- 00:00:00 older\n');
    assert.equal(agent(['log', 'new note']).code, 0);
    const last = agent(['status']).out.trim().split('\n')[3];
    assert.match(last, /^Last log: .*session-\d{4}-\d{2}-\d{2}\.md$/);
    assert.ok(!last.includes('2020-01-01'));
  });
});
