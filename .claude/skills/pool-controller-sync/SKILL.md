---
name: pool-controller-sync
description: This repo's conventions for pulling telemetry from a pool controller's cloud platform (currently Hanna Cloud, an unofficial reverse-engineered API) and writing it into Firestore as a Reading — api/cron/sync-pool-controller.ts, api/_lib/poolControllers/* (types.ts, sync.ts, firestoreAdapters.ts, hannaCloud/). Use this whenever adding a second controller brand, changing the dedupe/write logic, touching the cron trigger or its auth, or parsing anything from a third-party device API. NOT about the MCP server that later reads this data back out for LLM clients — see the sibling mcp-server skill for that. Trigger even if the user just says "add support for a Pentair controller" or "why does the Hanna sync skip readings" without naming this skill by name.
---

# Pool controller telemetry sync conventions

This is the write side of the pipeline: `api/cron/sync-pool-controller.ts` (the endpoint, auth, trigger) → `api/_lib/poolControllers/sync.ts` (source-agnostic sync logic) → `api/_lib/poolControllers/firestoreAdapters.ts` (the atomic write) → `hannaCloud/` (the one real `PoolControllerSource` implementation today). See CLAUDE.md's "Pool controller telemetry (Hanna Cloud)" section for the product-level why; this file is the "how to change this code correctly" version.

## The abstraction exists so a second brand is additive, not a rewrite

`PoolControllerSource` (`types.ts`) is the whole contract: `id` (a short string tag, e.g. `"hanna-cloud"`) and `getLatestReading(): Promise<PoolControllerReading | null>`. `sync.ts`'s `syncLatestReading()` knows nothing about Hanna, GraphQL, or Firestore — it's tested with an in-memory fake store and fake source. Adding a second controller brand (or an official Hanna API, should one ever ship) means writing a new class implementing `PoolControllerSource` and **not** touching `sync.ts` to special-case it — that logic belongs entirely in the new source implementation.

That said, `sync.ts` staying untouched doesn't mean nothing else needs to change: `api/cron/sync-pool-controller.ts` currently constructs the source directly (`new HannaCloudSource({ email, password, deviceId: ... })`, reading Hanna-specific env vars inline) — a new `PoolControllerSource` implementation is unreachable in production until something selects and configures it. Either extend the entry point to choose between sources (e.g. by an env var naming which brand is configured), or introduce a small source-factory function it calls instead of constructing `HannaCloudSource` directly — but the entry point (or that factory) does need to change; only `sync.ts` itself must stay source-agnostic.

## Never backfill a field the controller didn't report

A controller typically reports only `ph`, `sanitisationMv` (ORP), and `temperature` — `chlorine`, `alkalinity`, `totalChlorine`, `calciumHardness`, `cyanuricAcid`, `differentialPressure` are always written `null` by this path, never copied forward from an earlier reading. This is deliberate and load-bearing: a `Reading`'s timestamp is a claim about *when its values were measured*, and copying in an hours- or days-old chlorine value under a fresh timestamp would misrepresent stale chemistry as just-measured — corrupting `TrendCharts`' history (it plots every reading with a value as a real data point) and risking unsafe advice from `GeminiAssistant`. This was tried once and reverted after review; don't reintroduce it here. (Presentation-time backfill of the two slow-changing LSI inputs, `alkalinity`/`calciumHardness`, does happen — but only in `src/lib/readings.ts`'s `getLatestReadingForDisplay()`, at *display* time, never when writing the stored document. Keep that boundary if you touch either side.)

## A snapshot with zero usable measurements is not a partial reading — it's nothing

`HannaCloudSource.getLatestReading()` returns `null`, not an all-null `PoolControllerReading`, when none of `ph`/`sanitisationMv`/`temperature` parsed to a real number. Writing an all-null reading would silently blank out the dashboard's previous real snapshot *and* still advance the dedupe watermark below — so a corrected response for the same instant would later be rejected as "not newer than last sync." If you're parsing a new source's response shape, apply the same rule: no usable value at all means return `null` from the source, not a reading with every field empty.

## Third-party API responses get zero trust

Hanna Cloud's timestamp and parameter shapes aren't documented anywhere public and can change without notice (see `client.ts`'s comment on why — it's a TypeScript port of a reverse-engineered, unsupported integration). `source.ts` treats every field defensively:

- **Numbers**: `findParameterNumber()` only accepts a real `number` or a non-blank numeric string — plain `Number(value)` is avoided because JS coerces `''`, `'   '`, `false`, and `[]` to `0`, which would otherwise persist a fabricated 0 pH/ORP/temperature reading and could trigger a false critical alert.
- **Timestamps**: `parseHannaTimestamp()` accepts an ISO string or a Unix epoch in seconds *or* milliseconds (disambiguated by digit count), and **throws** rather than falling back to "now" on anything unrecognized. `sync.ts` dedupes by this timestamp, so a guessed value would make every poll look newer than the last and spam a duplicate reading into Firestore on every run.
- **Clock skew, not wall-clock trust**: a parsed timestamp implausibly far in the future (beyond a small skew allowance) is also rejected outright — an ingested garbage-future timestamp would become the permanent dedupe watermark, silently skipping every legitimate reading after it, possibly for months, while the endpoint keeps returning a normal-looking "already synced" result instead of an error anyone would notice.

Apply the same posture to any new source: parse defensively, throw on the genuinely unparseable rather than guessing, and think through what a bad value does to the *dedupe watermark* specifically — that's where a bad guess does the most silent, long-lived damage.

## Dedupe, write, and advance the watermark in one transaction

`firestoreAdapters.ts`'s `syncIfNewer()` does the "is this newer than last synced" check, the reading write, and the watermark advance inside a single `db.runTransaction()` — never as separate reads and writes. Two independent schedulers (Vercel Cron and the GitHub Actions poller) can invoke the same sync job at the same moment (both fire at 06:00 UTC daily); a plain read-then-write would let both see the same stale watermark and double-write. If you add any new state this path needs to check-then-write, put it in the same transaction rather than a separate round-trip.

The sync-state document lives in its own `poolControllerSyncState` collection, keyed `{ownerUid}_{sourceId}`, rather than being inferred from the `readings` collection itself (e.g. "the newest auto-logged reading") — that keeps dedupe correct even if a user edits or deletes an auto-logged reading from History.

## The written reading needs its own id field

`readings` documents carry their Firestore doc ID redundantly as an `id` field, because `App.tsx`'s reading listener spreads `doc.data()` without restoring `doc.id`. A reading document missing that field renders with `id: undefined`, breaking React keys and History's edit/delete. Any new write path into `readings` — from this sync job or elsewhere — must set it explicitly the same way `firestoreAdapters.ts` does (`randomUUID()`, used both as the doc ID and the `id` field).

## Auth: constant-time comparison, and don't assume it's cron-only

`api/cron/sync-pool-controller.ts` accepts either `CRON_SECRET` (the scheduled triggers) or a verified Firebase ID token belonging to the app's single owner account (the dashboard's manual "sync now" button) — see `checkAuthorization()`. Compare `CRON_SECRET` via SHA-256 digest + `node:crypto`'s `timingSafeEqual`, never plain `===` — this repo has hit the plain-string-comparison timing-leak bug here once already (and separately in the MCP server's bearer-token check; see the sibling `mcp-server` skill). If you add a third way to trigger this endpoint, route it through `checkAuthorization()` rather than a parallel check.

`CRON_SECRET` must never reach client code — it's read only server-side. `HANNA_CLOUD_EMAIL`/`HANNA_CLOUD_PASSWORD` are real account credentials, not an API key, and get the same server-only treatment; don't let either leak into anything bundled for the browser.

## Known limitation, not yours to silently fix

There's no pruning of the `readings` collection — the 15-minute GitHub Actions cadence writes ~96 documents/day/user forever, and `App.tsx`'s listener has no `limit()`. This is a deliberately accepted tradeoff (see CLAUDE.md's known-issues table) — a real fix touches pagination in History, the live listener, and TrendCharts/WeeklyReport's assumptions about holding the full history in memory, and deserves its own PR. Don't bundle a partial fix into unrelated sync-path work.

## Related

`mcp-server` (sibling skill) covers the read side of the same `readings` collection — the remote MCP server that serves this data back out to LLM clients, including how it treats a reading with mostly-null fields (a controller-only poll) versus a "note-only" log.
