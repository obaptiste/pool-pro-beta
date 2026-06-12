# PoolPro Beta

PoolPro Beta is a pool-maintenance logging and monitoring app.

It is designed to help operators record readings, review trends, capture maintenance notes, and highlight when values need attention. The goal is to make pool checks clearer, safer, and easier to follow over time.

## What this app is for

- Recording pool readings over time
- Keeping a clear maintenance history
- Showing non-blocking warnings when readings need attention
- Preserving unusual readings instead of preventing form submission
- Supporting reports after maintenance issues or incidents
- Making routine checks easier to review on mobile

## Important note

PoolPro Beta is a support tool. It does not replace professional servicing, product labels, contractor guidance, or local safety requirements.

## Core product principles

1. **Safety first.** Important warnings should be clear and visible.
2. **Never block the log.** Unusual readings should warn the user, but still be saved.
3. **Explain the numbers.** Technical readings should have plain-English helper text.
4. **Make next steps clear.** The interface should help the operator understand what needs attention.
5. **Keep it mobile-friendly.** The app may be used on-site, so screens should be clear, simple, and forgiving.

## Local development

### Prerequisites

- Node.js
- npm

### Install dependencies

```bash
npm install
```

### Run the development server

```bash
npm run dev
```

## Coding agent instructions

Custom coding-agent instructions live in [`AGENTS.md`](./AGENTS.md).

Any coding agent working on this repository should read that file before making changes.

## Current priorities

- Improve reading capture and maintenance logs
- Add clear warning states for values that need attention
- Ensure unusual values can be submitted with warnings rather than blocked
- Improve dashboard summaries
- Add concise helper text for technical readings
