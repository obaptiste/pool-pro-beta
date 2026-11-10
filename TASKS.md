# PoolStatus AI — Task Backlog

The actionable work for this repo. `CLAUDE.md` keeps the decision record (its
"Code Review — Known Issues & Decisions" table and Architecture Notes explain why
each item is the way it is); this file says what is still to do. Read `AGENTS.md`
before any item that touches safety guidance.

Priorities: **P1** = safety/correctness, do next · **P2** = high-value, soon ·
**P3** = nice-to-have.

Format: every open item is `- [ ] **P<n> — Title.** detail`, and `scripts/agent`
parses exactly that. Add `` `blocked: <reason>` `` to an item that cannot be worked
yet (for example, one that needs an operator action outside the repo);
`scripts/agent next` skips blocked items and `scripts/agent list` shows them
separately. An open item without a leading priority is reported as unparsed.
Tick an item in the same PR that finishes it.

---

## Correctness

- [ ] **P1 — Reconcile what an offset-less controller timestamp means.** The CSV
      importer (`src/lib/hannaCsv.ts`) reads it as the importing browser's local
      time; the cloud sync (`api/_lib/poolControllers/hannaCloud/source.ts`) reads it
      as UTC or the configured `HANNA_CLOUD_DEVICE_TIMEZONE` /
      `HANNA_CLOUD_DEVICE_UTC_OFFSET_MINUTES`. Make the importer use the same device
      clock. Its `startLocal`/`endLocal` strings feed `controllerLogDocId()`, so doc
      ids must not change (re-import stays idempotent) even though stored
      `start`/`end` shift. Known issue #17; own PR.

## Data growth and storage

- [ ] **P2 — Bound the `readings` and `controllerLogs` listeners.** `App.tsx` listens
      with no `limit()` while the 15-minute sync writes about 96 readings a day.
      Needs pagination in History, a bounded query for the live listener, and a
      separate aggregation path for TrendCharts and WeeklyReport, which all assume
      the full history is in memory today. Known issue #15; own PR, not a drive-by.
- [ ] **P2 — Make evidence-photo deletion actually work.** `handleDeleteReading`
      best-effort-deletes the Storage photo, but no `storage.rules` authorise it, so
      it silently no-ops and leaves the photo and its unexpiring URL orphaned. Add
      ownership-scoped storage rules or a server-side delete path. See the
      "Known limitation" under the MCP server notes in `CLAUDE.md`.
- [ ] **P2 — Deploy the `controllerLogs` composite index.** Until it is live,
      `poolstatus_list_controller_windows` fails with `FAILED_PRECONDITION`. Export
      the live indexes first, diff against `firestore.indexes.json`, add anything
      missing, and never deploy with `--force` (see Agent Instructions in
      `CLAUDE.md`). `blocked: operator action — needs Firebase CLI credentials`

## Hardening and tidy-up

- [ ] **P3 — Protect the client-bundled `GEMINI_API_KEY`.** It is exposed through
      the Vite `define` block on purpose (AI Studio pattern). Add Firebase App Check
      or route Gemini calls through a server proxy before any deployment outside AI
      Studio. Known issue #10.
- [ ] **P3 — Replace the hardcoded admin email in `firestore.rules`.** Use a custom
      claim. Acceptable for a solo project; required before multi-tenant use. Rules
      deploy separately. Known issue #9.
- [ ] **P3 — Align the `ReadingForm` `onSave` prop type with the `App.tsx` handler.**
      The prop type includes `uid`; the handler signature omits it and overrides the
      value. Harmless at runtime. Known issue #11.
- [ ] **P3 — Give `DEFAULT_EQUIPMENT` per-item install dates.** `new Date()` at
      module load gives every default item the same date. Only affects first-login
      seed data. Known issue #12.
- [ ] **P3 — Move the 15-minute controller sync onto Vercel Cron.** `vercel.json`
      runs once a day on the Hobby plan, so
      `.github/workflows/sync-pool-controller.yml` provides the real cadence. On a
      paid plan, tighten the `vercel.json` schedule and delete the workflow.
      `blocked: needs a paid Vercel plan`

## Not tracked here

Known issues #14 (Hanna Cloud has no official API) and #16 (the un-indented
write-tool block in `api/_lib/mcp/server.ts`) are accepted decisions with nothing
to do. They stay in `CLAUDE.md` only.
