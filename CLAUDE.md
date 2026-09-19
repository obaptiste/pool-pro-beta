# CLAUDE.md — PoolStatus AI

Agent guide for the `pool-pro-beta` repository.

## Project Overview

**PoolStatus AI** is a React 19 + Vite SPA for commercial pool maintenance professionals. It records water chemistry readings, runs Langelier Saturation Index (LSI) analysis, surfaces AI-generated maintenance protocols via Gemini, and tracks inventory / equipment service schedules. Data is persisted in Firebase Firestore with Google Auth sign-in.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite 6, Tailwind CSS v4, Framer Motion |
| Backend | Express (dev server + AI proxy), `server.ts` via `tsx` |
| Primary AI | Google Gemini (`@google/genai`) — client-side via Vite `define` |
| AI Fallback | Claude (`claude-sonnet-4-6`) → OpenAI GPT-4o, via `/api/ai/fallback` |
| Database | Firebase Firestore (multi-region) |
| Auth | Firebase Auth (Google Sign-In) |
| Deployment | Vercel (analytics via `@vercel/analytics`) |

## Key Files

```
server.ts                   Express server: Vite middleware + /api/ai/fallback
src/
  App.tsx                   Root: auth state, Firestore listeners, all handlers
  firebase.ts               Firebase init, helpers, error handler
  types.ts                  All types + DEFAULT_* seed data constants
  lib/
    gemini.ts               generateContentWithRetry() — exponential backoff for 429s
    ai.ts                   callAiWithFallback() — Gemini → server fallback chain
    lsi.ts                  calculateLSI() — shared Langelier Saturation Index logic
  components/
    Dashboard.tsx           Main view: LSI card, status grid, task checklist, alerts
    GeminiAssistant.tsx     Floating AI panel: analysis, checklist, supply locator
    ReadingForm.tsx         New reading entry with voice transcription (Gemini)
    Inventory.tsx           Chemical stock tracker
    Equipment.tsx           Equipment service schedule tracker
    TrendCharts.tsx         7-day trend charts (Recharts)
    History.tsx             Full reading history with delete
    ReminderSettings.tsx    Notification schedule settings
  sw.ts                     Service worker source (Workbox; vite-plugin-pwa injects the precache manifest at build)
  serviceWorkerRegistration.ts  Registers the worker via virtual:pwa-register (autoUpdate)
api/
  mcp.ts                     Remote MCP endpoint — read-only pool data for MCP clients
  cron/sync-pool-controller.ts  Pulls pH/ORP/temp telemetry from a Hanna Cloud pool controller into `readings`
  _lib/
    firebaseAdmin.ts          Shared Admin SDK bootstrap (service account, owner-uid resolution, Firestore handle)
    poolControllers/          Pool-controller abstraction: types.ts (PoolControllerSource), sync.ts (dedupe + write),
                               firestoreAdapters.ts, hannaCloud/ (client.ts + source.ts — see Architecture Notes)
    mcp/                      MCP server implementation and Firestore-backed data source
firestore.rules             Firestore security rules with field validation
vercel.json                 Vercel Cron config (pool controller sync)
```

## Development Commands

```bash
npm install          # Install dependencies
npm run dev          # Start Express + Vite dev server on :3000
npm run build        # Production Vite build → dist/
npm run lint         # TypeScript type-check (tsc --noEmit, app + service worker)
npm run preview      # Preview production build
```

## Environment Variables

Copy `.env.example` to `.env.local` and fill in:

```
GEMINI_API_KEY=      # Required — Gemini API key (also bundled into client via Vite define)
ANTHROPIC_API_KEY=   # Optional — Claude fallback
OPENAI_API_KEY=      # Optional — ChatGPT fallback
```

> **Note**: `GEMINI_API_KEY` is intentionally exposed to the client bundle via `vite.config.ts`'s `define` block (AI Studio pattern). Secure with Firebase App Check or an API proxy for production deployments that aren't behind AI Studio.

## Architecture Notes

### AI Call Chain
1. Client calls `callAiWithFallback()` with Gemini params
2. If Gemini fails (quota / error) → POST `/api/ai/fallback`
3. Server tries Claude (`claude-sonnet-4-6`) → OpenAI GPT-4o in order
4. `generateContentWithRetry()` handles 429 rate-limits with 3-attempt exponential backoff

### Firestore Data Model
- `readings/{id}` — pool chemistry readings, ordered by `timestamp desc`
- `tasks/{id}` — maintenance checklist items; seeded from `DEFAULT_POOL_TASKS` on first login
- `inventory/{id}` — chemical stock items; seeded from `DEFAULT_INVENTORY` on first login
- `equipment/{id}` — equipment registry; seeded from `DEFAULT_EQUIPMENT` on first login
- `schedules/{uid}` — test frequency and reminder schedule per user
- `poolControllerSyncState/{ownerUid}_{sourceId}` — server-only; last-synced marker for the pool controller telemetry job (see below)

All documents carry a `uid` field matched to `request.auth.uid` in Firestore rules. Rules also enforce field-level validation (types, enums, size limits).

### LSI Calculation
Langelier Saturation Index = `pH + TF + CF + AF − 12.1`
- Shared implementation lives in `src/lib/lsi.ts:calculateLSI()`
- Target: `−0.1` to `+0.1` (balanced); outside `±0.3` is critical

### Pool controller telemetry (Hanna Cloud)
`api/cron/sync-pool-controller.ts` polls a Hanna Instruments BL122/BL132 pool
controller via Hanna Cloud and logs its pH/ORP/temperature as a `Reading`
(`sanitisationMv` is ORP in mV). The controller doesn't measure
`chlorine`/`alkalinity`/`totalChlorine`/`calciumHardness`/`cyanuricAcid`/
`differentialPressure`, so these are stored `null` — a genuinely partial
reading, not a replacement for a manual test. **`sync.ts` never backfills
them from history before writing**: a Reading's timestamp is a claim about
when its values were measured, and copying an old value into a freshly
timestamped document would misrepresent stale chemistry as just measured —
corrupting TrendCharts' history (`buildTrendPoints` plots every reading with
a value as an actual data point) and risking unsafe advice from
GeminiAssistant, which is exactly what an earlier version of this feature
did before being caught in review.

Since Dashboard and GeminiAssistant both treat the single latest reading as
the complete current snapshot (they don't merge across readings), a
controller-only poll becoming `readings[0]` would otherwise blank those
fields' dashboard cards and make LSI ("needs ph + temperature +
calciumHardness + alkalinity") unavailable until the next manual test.
`src/lib/readings.ts`'s `getLatestReadingForDisplay()` — used by
Dashboard.tsx and App.tsx (for GeminiAssistant) instead of raw `readings[0]`
— fixes this at **presentation time only**: it backfills *just*
`alkalinity`/`calciumHardness` (LSI's two slow-changing inputs, normally
tested far less often than chlorine and reasonably treated as stable
between tests) from the most recent reading that has them **within the
last `MAX_BACKFILL_AGE_DAYS` (30) days** — beyond that (e.g. spanning a
drain/refill), the field is left `null` rather than silently presenting a
value that may no longer hold. Chlorine, totalChlorine, cyanuricAcid, and
differentialPressure are deliberately never backfilled, at write time or
display time — those can change fast enough, and matter enough for
safety, that showing a stale value as current is worse than showing "not
measured." `sanitisationMv` (ORP) — the only sanitiser signal a
controller sync ever reports — is wired into Dashboard's alerts/status
card and GeminiAssistant's prompts alongside chlorine, so a dangerously
low ORP from an auto-synced reading doesn't pass through silently.

- **No official API.** `api/_lib/poolControllers/hannaCloud/client.ts` is a
  TypeScript port of the reverse-engineered, MIT-licensed client behind Home
  Assistant's official "Hanna" integration
  ([github.com/bestycame/hanna_cloud](https://github.com/bestycame/hanna_cloud)) —
  itself explicitly documented as not supported by Hanna. It can break
  without notice if Hanna changes their backend.
- **Abstracted on purpose.** `api/_lib/poolControllers/types.ts`'s
  `PoolControllerSource` interface, and `sync.ts`'s source-agnostic dedupe
  logic, mean a second controller brand — or an official Hanna API, should
  one ever ship — is a new implementation of that interface, not a rewrite.
- **Trigger.** One bearer-token-protected endpoint
  (`CRON_SECRET`), driven by both Vercel Cron (`vercel.json`; once/day on
  the Hobby plan) and `.github/workflows/sync-pool-controller.yml` (every
  15 min, the real cadence until the project is on a paid Vercel plan —
  then tighten `vercel.json`'s schedule and delete the workflow).
- **Credentials are real account credentials**, not an API key —
  `HANNA_CLOUD_EMAIL`/`HANNA_CLOUD_PASSWORD` must stay server-side only,
  unlike the client-bundled `GEMINI_API_KEY` pattern above.
- **Atomic dedupe+write.** Because two independent schedulers can invoke
  the sync job at the same time (both fire at 06:00 UTC daily),
  `PoolControllerSyncStore.syncIfNewer()`'s Firestore implementation
  (`firestoreAdapters.ts`) does the "is this reading newer than last
  synced" check, the reading write, and the sync-state advance inside one
  `db.runTransaction()` — never as separate reads/writes.

## Code Review — Known Issues & Decisions

| # | File | Issue | Status |
|---|---|---|---|
| 1 | `server.ts:37` | Updated to `claude-sonnet-4-6` (was `claude-3-5-sonnet-20240620`) | Fixed |
| 2 | `src/lib/lsi.ts` | `calculateLSI` was duplicated in `Dashboard` and `GeminiAssistant` | Fixed — extracted to shared lib |
| 3 | `Dashboard.tsx` | `runLsiAnalysis` used bare `GoogleGenAI` bypassing retry utility | Fixed — uses `generateContentWithRetry` |
| 4 | `App.tsx` | `forEach(async ...)` for seeding default data — fire-and-forget, no error handling | Fixed — uses `Promise.all(...).catch(...)` |
| 5 | `App.tsx` | Dead `INITIAL_TASKS` / `INITIAL_READINGS` constants (never rendered) | Fixed — removed |
| 6 | `GeminiAssistant.tsx:287` | `window.alert()` for protocol-staged confirmation (blocks UI) | Fixed — inline success state with auto-dismiss |
| 7 | `Inventory.tsx`, `Equipment.tsx` | `Date.now().toString()` as document ID (collision-prone) | Fixed — `crypto.randomUUID()` |
| 8 | `claude.md` | Said "React 18" — project is React 19 | Fixed |
| 9 | `firestore.rules:101` | Admin email (`orisjb@gmail.com`) hardcoded in public rules | Known — acceptable for solo project; use custom claims for multi-tenant |
| 10 | `vite.config.ts:11` | `GEMINI_API_KEY` bundled into client JS | Known — intentional AI Studio pattern; see note above |
| 11 | `ReadingForm.tsx:23` | `onSave` prop type includes `uid` but `App.tsx` handler signature omits it | Known — `uid` field defaults `''` and is overridden in the handler; harmless runtime behaviour |
| 12 | `types.ts:57–59` | `DEFAULT_EQUIPMENT` uses `new Date()` at module load — all default items get same install date | Known — only affects first-login seed data |
| 13 | `api/_lib/aiFallback.ts` | CodeQL `js/system-prompt-injection`: `/api/ai/fallback` builds each provider's system message from the request body's `systemInstruction` | Fixed — framed as caller-supplied configuration rather than raw authority (see comment above `framedSystemInstruction`); the endpoint is an intentional generic completion proxy where the caller already controls the whole request and nothing server-side acts on the output, so there's no privilege boundary being crossed today, but framing costs nothing |
| 14 | `api/_lib/poolControllers/hannaCloud/client.ts` | Talks to Hanna Cloud's private GraphQL API — no official API exists | Known — accepted risk; see "Pool controller telemetry" above |

## Agent Instructions

- **Always run `npm run lint` after edits** — the lint command is `tsc --noEmit` and catches type errors.
- **Automated tests**: `npm test` runs `node:test` files matching `src/**/*.test.ts` and `api/**/*.test.ts`. Run it after edits to those areas; there's no UI/e2e coverage, so validate UI changes manually via the dev server.
- **Firestore rules** live in `firestore.rules`; changes there must be deployed separately with `firebase deploy --only firestore:rules`.
- **Do not commit** `.env.local`, `firebase-applet-config.json` secrets (the config file contains a public API key that is intentionally committed — this is a Firebase web client key, not a secret).
- **AI model names**: Use `gemini-2.0-flash` for fast/cheap Gemini calls and `claude-sonnet-4-6` for Claude fallback.
- When adding new Firestore collections, add rules to `firestore.rules` and a validator function following the existing pattern.
