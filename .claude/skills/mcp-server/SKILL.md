---
name: mcp-server
description: This repo's own conventions for its remote MCP server (api/_lib/mcp/*, api/mcp.ts) — a read/write pool-data endpoint for external MCP clients (Claude, ChatGPT, etc.), with 7 read tools and 4 write tools (logging readings with photo evidence, adding/completing tasks, adjusting inventory). Use this whenever adding or changing an MCP tool, touching anything under api/_lib/mcp/, working on api/mcp.ts, or reasoning about this server's auth, pagination, or tool-description conventions. This is NOT a general "how do I build an MCP server" guide — for that, use a generic MCP-building skill instead. This one captures the specific, hard-won patterns already established in this codebase (tool description format, annotations, bounded pagination, uid scoping, the PoolDataSource testability seam) so new tools stay consistent instead of quietly drifting from them. Trigger even if the user just says "add an MCP tool for X" or "why does poolstatus_get_reading_trends do Y" without naming this skill.
---

# PoolStatus MCP server conventions

The MCP server lives in `api/_lib/mcp/` (`server.ts` has the tools, `handler.ts` the transport/auth, `firestoreSource.ts` the storage adapter, `types.ts` the `PoolDataSource` interface, `cursor.ts` pagination helpers) and is mounted from `api/mcp.ts` (Vercel) and `server.ts`'s `/api/mcp` route (Express dev server) — both call the same `handleMcpRequest`. It has 7 read tools and 4 write tools today. See `docs/mcp-server.md` for the full architecture writeup (request lifecycle, safety model, deep dive on the photo-upload path) — this file is the condensed "how to add/change a tool correctly" version; read the doc before a non-trivial change, use this skill as the checklist while making it.

Every point below exists because getting it wrong already cost a review round in this repo — they're not arbitrary style preferences.

## Tool registration shape

```ts
server.registerTool(
  'poolstatus_verb_noun',          // poolstatus_ prefix, verb_noun
  { title, description, inputSchema /* zod */, annotations },
  async (args) => { ... },
);
```

## The description is UX, not documentation

An MCP client picks which tool to call — and how to call it — purely from `description`. A skimpy one causes wrong-tool or wrong-args calls with no way to correct it after the fact. Every tool in this server follows the same shape; match it:

```
<One or two sentences on what this returns and any non-obvious behavior.>

Args:
  - arg_name (type, constraints): what it does, default if any

Returns: { shape: "as it actually appears in the JSON" }. <Call out anything a
client needs to know to use the response correctly — e.g. what null means for
a field, what a status enum's values are.>

Use when: "<a realistic natural-language question this tool answers>", "<another one>"
Don't use when: <what to use instead, if a nearby tool is often confused with this one>
```

Write `Use when` examples as things a real person would actually ask, not paraphrases of the tool name — the client is matching intent, not keywords.

## response_format and the dual content/structuredContent return

Every read tool that returns a list or a single record — `get_latest_reading`, `list_readings`, `get_reading_trends`, `list_tasks`, `list_inventory`, `list_equipment` — takes `response_format: 'markdown' | 'json'` (zod enum, default `'markdown'`): markdown for a client rendering to a human, json for one that's going to parse the numbers. `get_schedule` and the four write tools skip it — they return one small, fixed-shape record where a markdown/json split adds an argument without adding value; don't add it there reflexively just because most tools have it.

For a **successful** result, return the raw structured data plus text via the shared `toolResult(structured, text)` helper in `server.ts`, which wraps them as `{ content: [{ type: 'text', text }], structuredContent: structured }`. Don't hand-roll this shape inline. `text` itself is not always markdown, though: on the 6 tools that take `response_format`, the non-empty-result branches make `text` follow it — `JSON.stringify(output, null, 2)` when the caller asked for `'json'`, a markdown-formatting function otherwise. The *empty*-result branches on those same 6 tools (no readings/tasks/inventory/equipment found, an empty pagination window) don't, though — they return fixed English prose regardless of `response_format`, which is a real, pre-existing gap: a client that requests `'json'` and parses `content[0].text` as JSON (rather than reading `structuredContent`, which is always present and correctly shaped even when empty) will succeed for a non-empty result and then hit invalid JSON the moment the result happens to be empty. Don't copy that shortcut into a new success path — if a tool takes `response_format`, make *every* success branch honor it, including the empty case (e.g. `response_format === 'json' ? JSON.stringify(output) : 'No X found.'`), so callers don't get a different contract depending on how many rows came back. Write tools genuinely don't need this at all, since none of them take `response_format` in the first place.

`toolResult()` is only for success. Every validation/not-found failure in this server (there are 10 of them — invalid pagination cursor, no measurement provided, an impossible value, a bad timestamp, an invalid/oversized/corrupt photo, a missing task/inventory id, a unit mismatch) returns `{ content: [{ type: 'text', text: message }], isError: true }` directly instead — no `structuredContent`, and critically, `isError: true`, which is what tells an MCP client the call failed rather than succeeded with this text as the answer. Never route an error path through `toolResult()`; it has no way to carry `isError` and a client would read the failure as a normal result.

## Tool annotations

Four constants, reused across the 11 tools — pick the one matching the *real* semantics of a new tool, don't default to whichever is closest:

```ts
const READ_ONLY          = { readOnlyHint: true,  destructiveHint: false, idempotentHint: true,  openWorldHint: false };
const WRITE_CREATE        = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }; // poolstatus_add_task
const WRITE_DESTRUCTIVE   = { readOnlyHint: false, destructiveHint: true,  idempotentHint: false, openWorldHint: false }; // poolstatus_log_reading, poolstatus_adjust_inventory
const WRITE_COMPLETE      = { readOnlyHint: false, destructiveHint: true,  idempotentHint: true,  openWorldHint: false }; // poolstatus_complete_task
```

The MCP spec defines `destructiveHint: false` as "only additive updates" — a host may use that to skip confirmation. Reasoning actually used per tool here (see the comments above these constants in `server.ts`):

- `poolstatus_add_task` is `WRITE_CREATE`: a brand-new document, nothing existing is touched.
- `poolstatus_log_reading` is `WRITE_DESTRUCTIVE` even though creating the reading document is purely additive — because every successful call *also* overwrites `schedules/{ownerUid}`'s `lastTestDate`/`nextTestDate`. Don't judge a tool's annotation by its primary effect alone; check every side effect.
- `poolstatus_adjust_inventory` is `WRITE_DESTRUCTIVE` because a negative delta consumes (overwrites) existing stock, not just adds to it.
- `poolstatus_complete_task` is `WRITE_COMPLETE`: `idempotentHint: true` because calling it twice with the same id converges (still completed), but `destructiveHint: true` too, because `PoolDataSource` exposes no way to reopen a task — idempotent isn't the same as safe-to-apply-without-confirmation when there's no undo.

`idempotentHint: true` means calling the tool twice with the same args converges to the same state, not merely "doesn't error the second time" — an adjustment that *adds* an amount each call is never idempotent; a tool that *sets* a value can be.

## Bounded pagination for readings specifically — don't assume it's everywhere

`poolstatus_list_readings` is the one tool that actually paginates: it caps `limit` at `MAX_LIST_LIMIT` and returns `{ has_more, next_before }`, with the cursor (via `cursor.ts`'s helpers) built from a **compound key** — `(timestamp, id)`, not timestamp alone. Firestore rows can share a millisecond timestamp on rapid writes, so a timestamp-only cursor would skip or duplicate rows sitting on either side of that tie. `poolstatus_list_tasks`, `poolstatus_list_inventory`, and `poolstatus_list_equipment` do **not** paginate today — they call unbounded `PoolDataSource` methods (no `limit`, no cursor) and return the whole collection every time, because tasks/inventory/equipment are naturally small (a checklist, a stock list, a piece count), unlike `readings`, which is genuinely unbounded (see CLAUDE.md's known-issue on that).

If you're extending `list_readings`, order the underlying query and build the cursor off the same compound key `poolstatus_list_readings` uses — they have to agree, or paging silently drops or repeats rows.

If you're adding pagination to one of the other three list tools instead, **don't copy `list_readings`'s `(timestamp, id)` cursor literally** — that shape only works because `readings` is ordered by timestamp with `id` as its tie-breaker. The three collections don't share that: `listTasks` currently orders by `createdAt` (so a cursor there would be `(createdAt, id)`), while `listInventory` and `listEquipment` have **no `orderBy` at all** today (arbitrary Firestore document order) — pagination on either would first need to pick a real sort order (most likely just `id`, or add a `createdAt`-equivalent field) before a cursor makes sense at all. The actual rule `list_readings` demonstrates is: **the cursor must encode exactly the fields the query is ordered by, plus a unique tie-breaker for any field that isn't already unique** — apply that rule to whatever each specific query's real ordering is, don't transplant `readings`' specific fields onto a different collection.

## Bounded aggregation over an unbounded collection

`poolstatus_get_reading_trends` is the pattern to copy for "summarize N days/rows of X" over a collection with no upper bound (see CLAUDE.md's "unbounded readings growth" known issue — this collection genuinely has no ceiling). The collection also interleaves note-only rows (measurements all null, just a note) that shouldn't eat a slot in the result cap ahead of real data. The shape:

1. Page through raw rows, keeping only ones that pass a real "has this got a measurement" filter.
2. Keep paging past a page that turned out to be all notes — don't give up just because one page was empty of real data.
3. Stop at a hard `MAX_*_FETCH_ROWS` ceiling, separate from and larger than the result cap `MAX_*_ROWS` — this bounds the cost of a pathological window (mostly/entirely note-only) to one tool call instead of unbounded reads.
4. Report `truncated: true` whenever either cap was hit, and adjust the returned window boundary (`from`, etc.) to reflect what was *actually* scanned — never silently present a partial result as if it covered the full requested window.

## Reuse the app's own domain logic — never re-derive a threshold, and be honest about what's actually shared

What's genuinely centralized and safe to import as-is: the LSI *value* (`src/lib/lsi.ts`'s `calculateLSI()`), combined-chlorine warnings and generic soft-validation (`src/lib/readingValidation.ts`'s `getSoftWarning()`/`combinedChlorineOf()`/`getCombinedChlorineWarning()`).

What is **not** centralized, despite looking like it should be — don't assume these exist in `src/lib/` just because the pattern above suggests they would:

- **LSI status/label** (turning the numeric LSI into "critical"/"balanced"/"scale-forming" etc.) is duplicated: `server.ts` has its own private `lsiStatus()`/`lsiLabel()`, and `Dashboard.tsx` has its own separate `getLsiStatus()`. Neither imports from the other. If you need this classification in a new tool, that's currently a third copy to keep in sync by hand — flag it rather than silently duplicating a fourth time, ideally by extracting a shared helper into `src/lib/lsi.ts` first.
- **"Near the edge of range" messaging** is a private function in `server.ts` (`nearEdgeMessage()`), not exported from `readingValidation.ts` or anywhere else — there's nothing to import for this one today.
- **ORP/sanitisation status** has two *different* classifiers, and — unlike the LSI case — this one has real safety stakes, since AGENTS.md is explicit: "Above 800 mV: warn that sanitisation may be high; verify before swimming or adding more chlorine."
  - `src/lib/readings.ts`'s `classifyOrp()` implements that 650/800 mV boundary directly and is what `Dashboard.tsx`/`WeeklyReport.tsx` use.
  - This server's own `getSanitisationMvStatus()` is built on `readingValidation.ts`'s `getSoftWarning()` instead, which treats 750–850 mV as "elevated, usually acceptable" — so an MCP result between 801–850 mV currently does **not** carry AGENTS.md's "verify before swimming" guidance the way `classifyOrp` would. This is a pre-existing gap against AGENTS.md in already-merged code, not a stylistic choice between two equally valid options. **New ORP status work should follow `classifyOrp`'s 800 mV boundary** (it's the one that actually matches AGENTS.md); don't extend or copy `getSanitisationMvStatus`'s softer band into anything new. If you're touching this area, flagging the existing gap for a fix is more in line with this project's own precedent (CLAUDE.md documents a near-identical past bug: "a hardcoded ORP threshold that disagreed with [AGENTS.md]") than treating both classifiers as interchangeable.

## PoolDataSource: the seam that keeps this testable without Firestore

Every tool reads through the `PoolDataSource` interface (`types.ts`), never Firestore directly. `firestoreSource.ts` is the real implementation; `server.test.ts` exercises tool logic against an in-memory fake with zero credentials needed. Adding a tool that needs new data: extend `PoolDataSource` first, implement the new method in `firestoreSource.ts`, and write the tool's logic against a fake source in a test — don't reach into `firebase-admin/firestore` from inside `server.ts`.

## Auth is constant-time and stateless

`handler.ts`'s `tokenMatches()` compares the bearer token as SHA-256 digests via `node:crypto`'s `timingSafeEqual`, never a plain `===`. This repo has hit the plain-`===`-on-a-secret timing-leak bug twice now (once here, once in `api/cron/sync-pool-controller.ts`'s `CRON_SECRET` check) — if you're adding any new secret/token comparison anywhere in this codebase, use this pattern, not `===`. Requests are also rate-limited per IP (`isRateLimited`), and the transport is stateless per-request (`sessionIdGenerator: undefined`) since the Vercel function and the Express dev server need identical behavior with no shared session state between them.

## uid scoping is the *only* access control once inside the Admin SDK

`firestoreSource.ts`'s `ownedBy(collection)` helper adds `.where('uid', '==', ownerUid)` to every query. The comment above it says why this matters more than it looks: **the Admin SDK bypasses `firestore.rules` entirely** — this uid filter is the only thing standing between a valid bearer token and every user's data (moot for now since the app has one owner, but the pattern must hold for that to stay true). Any new Firestore query added to `firestoreSource.ts` must go through `ownedBy()` or an equivalent explicit uid filter. There is no other backstop.

## Fail fast on misconfiguration, not per-call

`createFirestoreSource()` is `async` and resolves the owner uid / validates config eagerly, so `api/mcp.ts` surfaces a bad deployment (missing service account, unset owner) as one clean 503 when the client first connects — not as every single tool call failing after the client was already told the server was healthy. Any new startup dependency a tool needs should be resolved here, not lazily inside the tool handler.

## Write tools: ambiguous failure, never guessed away

`poolstatus_log_reading` (photo-evidence upload, then a Firestore write) is the reference implementation for "what happens when a write's acknowledgement gets lost" — read `firestoreSource.ts`'s `createReading()` and `uploadReadingPhoto()` before writing a new write tool, they're worth it in full. The shape, and why:

- A rejected `set()`/`save()` does **not** mean the write never reached the server — the client can lose the acknowledgement (network blip, deadline lapse) after the commit already landed. Since `set()` is idempotent, `createReading` retries the identical write once — always safe, and if it succeeds, that's definitive proof, not a guess.
- If the retry *also* fails, this codebase deliberately does **not** fall back to a verification read. A `get()` is only a point-in-time snapshot; the retry's own commit could still be in flight server-side when a follow-up read observes the document absent, so no finite number of retry-then-verify rounds ever produces a provably-safe "confirmed absent." Rather than chase that, it stops trying to prove absence and leaves any uploaded photo in place — an occasional orphaned Storage object is a far cheaper mistake than silently discarding evidence. This directly follows AGENTS.md's "never block evidence" rule; if you're writing a tool that touches something AGENTS.md doesn't call irreplaceable evidence, a plain retry-and-surface-the-error may be the right (simpler) choice instead — don't copy this pattern reflexively, understand which failure mode it's protecting against.
- `uploadReadingPhoto`'s own cleanup-on-failure is unconditional delete-and-ignore-the-result, *without* an existence probe first — because nothing has a reference to that path yet (no URL has been returned to any caller), so deleting a possibly-nonexistent object is always safe, and probing first would just add its own inconclusive-result case to get wrong.
- Side effects that aren't the tool's primary point (here, `advanceSchedule` updating the testing schedule after a reading is logged) are treated as best-effort: their failure must not fail the whole call, since the primary write already durably succeeded and an MCP client that sees a tool-call failure may retry — which would create a duplicate reading. `advanceSchedule` also no-ops if the incoming timestamp isn't newer than the stored one (a backdated photo shouldn't un-advance a schedule a more recent reading already moved forward), and reads-compares-writes inside one transaction so two readings logged back-to-back can't race each other.

Two more specific lessons already paid for in this codebase:

- **Don't reuse an existing flag for a new write path without checking every other place that reads it.** `poolstatus_add_task` stores `isAI: false`, deliberately *not* reusing the in-app AI assistant's own flag — an unrelated code path (`App.tsx`'s protocol-execution handler) treats `isAI: true` tasks as disposable and wipes them the next time an AI protocol runs, which would have silently deleted a task the MCP client was explicitly asked to add. Grep every reader of a flag before reusing it for something new.
- **Abnormal-but-physically-possible values are never rejected**, only genuinely impossible ones (non-finite, or below a field's physical minimum) — see `getImpossibleValueError` and its callers. A dangerously high or low reading is exactly the kind of incident evidence AGENTS.md says this app exists to capture; a write tool that "validates" by rejecting surprising-but-real values would defeat that. Surface a warning in the response instead (same non-blocking pattern the manual entry form uses), never an error, for anything that's merely unusual.

## Related

`pool-controller-sync` (sibling skill) covers the write side of the same `readings` collection — the Hanna Cloud telemetry ingestion this server reads back out. Worth a glance if a change here touches how partial/null-field readings are represented, since both sides agree on that shape.
