# PoolPro Beta — Custom Instructions for Coding Agents

## Project purpose

PoolPro Beta is a pool-maintenance support app for recording, interpreting, and acting on swimming-pool readings. It should help the operator make safer, clearer decisions around pH, sanitisation/ORP, chlorine, algae recovery, clarifier, algaecide, backwashing, and ongoing maintenance.

This app is not a replacement for professional pool servicing or chemical product labels. It should support decision-making, highlight risk, preserve a clear log, and make it harder to miss important warning signs.

## Product principles

1. **Safety first, always.** If a pool reading is dangerous, abnormal, or outside the recommended range, the app must warn clearly without hiding the value or blocking the maintenance log.
2. **Never block evidence.** Operators must be able to submit out-of-range readings to the database. A warning should not prevent saving. The historical record matters.
3. **Explain what the number means.** Values like ORP/mV, pH, free chlorine, alkalinity, and stabiliser should have short, plain-English explanations.
4. **Make the next action obvious.** When possible, suggest the next safe check: retest, circulate, backwash, wait before swimming, check dosing containers, or contact the pool contractor.
5. **Respect uncertainty.** Dose calculations should show assumptions and prompt for missing inputs such as pool volume, product concentration, and target range.
6. **Keep it mobile-friendly.** This app may be used beside a pool, in a plant room, on a phone, with wet hands and low patience. Interfaces should be clear, large, and forgiving.

## Domain context

Known working context from the PoolPro Beta use case:

- Pool volume used in examples: approximately **68,000 litres**.
- The system may track pH, ORP/sanitisation power in mV, chlorine, alkalinity, temperature, notes, actions taken, and chemical additions.
- ORP/sanitisation readings can fall dangerously low during algae blooms; one historical low was around **233 mV**.
- pH has been adjusted toward roughly **7.2–7.4** before shocking or sanitisation recovery.
- The app should support logging stabilised chlorine granules, sodium hypochlorite/liquid chlorine, pH reducer/acid, clarifier, and algaecide.
- The operator may not initially know what each reading means, so the app should teach gently without shaming.

## Pool chemistry safety rules

Use conservative, non-reckless guidance. Do not present chemical advice as absolute certainty.

### pH

- Typical target range: **7.2–7.6**.
- Warn below **7.0** as very low/acidic.
- Warn above **7.8** as high and likely to reduce chlorine effectiveness.
- Allow values outside the normal range to be saved.
- If pH is very high or low, show a warning and suggest retesting before heavy chemical dosing.

### ORP / sanitisation power

- ORP is often shown in **mV** and indicates sanitising effectiveness, not a direct chlorine ppm value.
- Treat low ORP as a warning, especially if combined with cloudy/green water.
- Suggested broad thresholds:
  - Below **650 mV**: warn that sanitisation may be weak.
  - Around **650–750 mV**: generally acceptable working zone, depending on pool system and local guidance.
  - Above **800 mV**: warn that sanitisation may be high; verify before swimming or adding more chlorine.
- Never block saving low or high ORP values. These values are essential for incident reports.

### Chlorine and shocking

- Before suggesting chlorine additions, prefer requiring or displaying:
  - pool volume,
  - product type,
  - product concentration,
  - current reading,
  - target reading,
  - whether the pool is occupied or closed,
  - whether circulation/filtration is running.
- After shocking or large additions, advise circulation and retesting.
- Avoid promising that water is safe to swim immediately after chemical additions.
- Include a reminder to follow the chemical product label and site-specific pool contractor guidance.

### Algaecide and clarifier

- Algaecide is not a substitute for adequate sanitisation.
- Clarifier helps collect fine particles but can increase filter load; remind users to monitor pressure and backwash/clean as appropriate.
- If algae is present, the app should prioritise pH correction, chlorine/sanitisation recovery, circulation, filtration, brushing/vacuuming, and retesting.

## Form behaviour and validation

Critical requirement: **out-of-range values must not prevent submission**.

Recommended behaviour:

- Use validation to catch impossible input formats, not real-world abnormal readings.
- Example: reject empty required fields, text in numeric fields, negative values where impossible, or missing date/time.
- Do not reject high pH, low ORP, high chlorine, unusual alkalinity, or other abnormal but possible readings.
- Show warnings as non-blocking alerts, banners, helper text, or confirmation panels.
- Persist the original submitted reading exactly as entered, alongside any interpreted status.

Good pattern:

```ts
const status = classifyPoolReading(reading);
await saveReading({ ...reading, status, warnings: status.warnings });
```

Bad pattern:

```ts
if (reading.ph > 7.8) throw new Error("pH too high");
```

## Data model guidance

Prefer structured records that preserve both measurements and actions.

Suggested reading fields:

- `id`
- `createdAt`
- `measuredAt`
- `location` or `poolId`
- `ph`
- `orpMv`
- `freeChlorine`
- `combinedChlorine`
- `alkalinity`
- `cyanuricAcid`
- `temperatureC`
- `waterClarity`
- `waterColour`
- `filterPressure`
- `pumpMode`
- `notes`
- `warnings`
- `actionsTaken`

Suggested chemical log fields:

- `id`
- `createdAt`
- `chemicalName`
- `chemicalType`
- `amount`
- `unit`
- `concentration`
- `reason`
- `relatedReadingId`
- `circulationStartedAt`
- `retestDueAt`
- `notes`

## UI and UX guidance

- Prefer dashboard cards with simple status language: `Good`, `Watch`, `Warning`, `Critical`.
- Use colour carefully, but do not rely on colour alone. Include text labels and icons.
- Make the most urgent warning visible at the top of the reading summary.
- On mobile, use large tap targets and short forms.
- Include contextual helper text: “ORP is sanitisation power in mV — low readings can mean chlorine is not working effectively.”
- Avoid shaming language. The app should feel like a calm co-pilot, not a clipboard-waving inspector.

## Architecture guidance

Respect the existing stack in the repository. Before changing architecture, inspect:

- `package.json`
- app/router structure
- component directories
- data-fetching patterns
- database/API implementation
- environment variable usage

When adding new functionality:

1. Keep domain logic in reusable utility files where possible, not buried inside components.
2. Keep thresholds configurable rather than hard-coded throughout the UI.
3. Prefer typed functions and explicit return shapes.
4. Keep calculations deterministic and unit-tested.
5. Avoid broad rewrites unless necessary.

Suggested structure if no existing equivalent exists:

```txt
lib/pool/thresholds.ts
lib/pool/classifyReading.ts
lib/pool/dosing.ts
components/pool/ReadingWarning.tsx
components/pool/SanitisationCard.tsx
components/pool/ChemicalLogForm.tsx
```

## Coding standards

- Use TypeScript where the project supports it.
- Prefer small, named functions over large inline blocks.
- Use clear domain names: `orpMv`, `ph`, `freeChlorine`, `poolVolumeLitres`.
- Avoid vague names like `value1`, `status2`, or `chemicalThing`.
- Keep comments useful and practical. Explain assumptions and safety decisions.
- Do not add secrets to the repository.
- Do not remove existing functionality without explaining why.

## Testing expectations

When changing pool-reading logic, add or update tests for:

- normal readings,
- low pH,
- high pH,
- very low ORP,
- high ORP,
- missing optional readings,
- out-of-range values that should warn but still submit,
- dose calculation edge cases.

If the project has no test framework yet, add pure utility functions that are easy to test later and include manual test notes in the PR summary.

## Accessibility

- Warnings must be readable by screen readers.
- Form errors and warnings should be associated with relevant fields.
- Do not rely on colour alone for status.
- Ensure keyboard navigation works for forms and dialogs.

## Deployment and environment

- Do not expose API keys or operational secrets client-side.
- Check Vercel build behaviour before adding server-only dependencies.
- Keep environment variable names documented in README or `.env.example` if new variables are added.
- Keep setup instructions product-focused and avoid references to temporary scaffolding tools.

## Pull request expectations

Every PR should include:

- what changed,
- why it changed,
- safety implications,
- how it was tested,
- screenshots for UI changes where possible,
- any assumptions about pool volume, chemical strength, or thresholds.

## Current priority areas

1. Add sanitisation/ORP tracking if missing.
2. Allow abnormal readings to be submitted while showing clear warnings.
3. Add dashboard warnings for low sanitisation and high/low pH.
4. Improve incident-report support by preserving readings, actions taken, and chemical additions.
5. Add clear notes explaining what pH, ORP, chlorine, clarifier, and algaecide mean.

## Tone of the app

PoolPro Beta should feel calm, competent, and practical — like a quiet poolside assistant saying:

> “Here’s what the water is telling us. Here’s what matters. Here’s what to check next.”

No panic. No guesswork dressed up as certainty. Just clear readings, sensible warnings, and a reliable log.
