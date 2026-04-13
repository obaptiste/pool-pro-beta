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
firestore.rules             Firestore security rules with field validation
```

## Development Commands

```bash
npm install          # Install dependencies
npm run dev          # Start Express + Vite dev server on :3000
npm run build        # Production Vite build → dist/
npm run lint         # TypeScript type-check (tsc --noEmit)
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

All documents carry a `uid` field matched to `request.auth.uid` in Firestore rules. Rules also enforce field-level validation (types, enums, size limits).

### LSI Calculation
Langelier Saturation Index = `pH + TF + CF + AF − 12.1`
- Shared implementation lives in `src/lib/lsi.ts:calculateLSI()`
- Target: `−0.1` to `+0.1` (balanced); outside `±0.3` is critical

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

## Agent Instructions

- **Always run `npm run lint` after edits** — the lint command is `tsc --noEmit` and catches type errors.
- **No test suite** — there are no automated tests. Validate changes manually via the dev server.
- **Firestore rules** live in `firestore.rules`; changes there must be deployed separately with `firebase deploy --only firestore:rules`.
- **Do not commit** `.env.local`, `firebase-applet-config.json` secrets (the config file contains a public API key that is intentionally committed — this is a Firebase web client key, not a secret).
- **AI model names**: Use `gemini-2.0-flash` for fast/cheap Gemini calls and `claude-sonnet-4-6` for Claude fallback.
- When adding new Firestore collections, add rules to `firestore.rules` and a validator function following the existing pattern.
