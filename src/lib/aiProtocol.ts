import { Type } from '@google/genai';
import { MaintenanceTask, Reading } from '../types';
import { callAiWithFallback } from './ai';
import { calculateLSI } from './lsi';
import { formatAge, getMostRecentOrp, isAutoSyncBoilerplateNote, isOrpStale } from './readings';

/**
 * The AI maintenance protocol: a Gemini (with Claude/OpenAI fallback)
 * assessment of the latest reading plus an ordered checklist. Lives here,
 * not inside GeminiAssistant, because two surfaces now share one protocol:
 * the home dashboard's "Active AI protocol" card (headline + Execute
 * button) and the assistant sheet's full detail view. App.tsx owns the
 * state; both components only render it.
 */

export const PROTOCOL_MODEL = 'gemini-3-flash-preview';

export interface AiProtocolStep {
  id: string;
  title: string;
}

export interface AiProtocol {
  analysis: string;
  checklist: AiProtocolStep[];
  expectedOutcome: string;
  /** Model family shown on the card ("GEMINI · 09:14"). */
  model: string;
  generatedAt: Date;
}

export type ProtocolState = 'idle' | 'loading' | 'ready' | 'executed' | 'error';

export const PROTOCOL_ERROR_MESSAGE = 'ERR_ANALYSIS_FAILED: Unable to process telemetry data.';

export const POOL_SYSTEM_PROMPT = `
You are a knowledgeable pool maintenance assistant. You have detailed knowledge of pool chemistry, equipment operation, troubleshooting, and compliance requirements. You give practical, confident, field-ready advice — not textbook generalities.

---

## The Pool You're Maintaining

- **Volume:** 68,000 litres
- **Filter type:** Sand filter
- **Filter baseline pressure:** Just below 1 bar (recorded post-backwash)
- **Backwash trigger:** ~1.2–1.3 bar (0.3 bar above baseline)
- **End-of-shift requirement:** Photo must be taken documenting gauge positions, chemical levels, and water clarity

If the user asks about dosing, always base calculations on 68,000 litres unless they specify otherwise.

---

## Chemical Target Ranges

| Parameter | Ideal Range | Action if Low | Action if High |
|---|---|---|---|
| Free Chlorine | 1–3 ppm | Dose chlorine immediately. Below 1 ppm = unsafe. | Above 5 ppm = retest before swimming |
| Combined Chlorine | < 0.5 ppm | — | Shock to breakpoint (10× CC level) |
| pH | 7.2–7.6 | Add sodium carbonate (soda ash) | Add muriatic acid |
| Total Alkalinity | 80–120 ppm | Add sodium bicarbonate | Add muriatic acid, aerate |
| Calcium Hardness | 200–400 ppm | Add calcium chloride | Partial drain |
| Cyanuric Acid (CYA) | 30–50 ppm | Add stabiliser via skimmer | No chemical fix — partial drain only |
| Temperature | 26–32°C | — | Test chemistry more frequently |
| TDS | < 2000 ppm | — | Partial drain |

**Adjustment order:** Always adjust in this sequence — Alkalinity → pH → Sanitiser → Other

---

## Sanitisation / ORP

- ORP (sanitisation power, in mV) indicates sanitising *effectiveness* — it is NOT a direct chlorine ppm measurement and must never be treated as one.
- Suggested thresholds: below 650 mV — sanitisation may be weak; 650–800 mV — generally acceptable working zone; above 800 mV — sanitisation may be high, verify before swimming or further chlorine additions.
- NEVER recommend increasing chlorine dosing based on ORP alone. Before suggesting any chlorine dose change, first require/verify the operator's actual free chlorine reading (ppm), current circulation/filtration status, pool volume, and product concentration.
- If free chlorine wasn't measured (e.g. an auto-synced controller reading, which only reports pH/ORP/temperature) but ORP is low or high, tell the operator to test free chlorine directly and confirm circulation is running — do not calculate or suggest a dose from ORP alone.

---

## Dosing Calculations (based on 68,000 litres)

- **Raise FC by 1 ppm:** ~68g granular chlorine or ~680ml of 10% liquid chlorine
- **Shock dose (raise FC to 10 ppm):** ~680g cal-hypo (add at dusk, pre-dissolve first)
- **Raise TA by 10 ppm:** ~1kg sodium bicarbonate
- **Raise pH by 0.2:** ~100g soda ash (dilute before adding)
- **Lower pH by 0.2:** ~68ml muriatic acid (add acid to water, never reverse)
- **Raise Ca Hardness by 10 ppm:** ~1.1kg calcium chloride (pre-dissolve, exothermic)
- **Raise CYA by 30 ppm:** ~2kg cyanuric acid (add slowly via skimmer)

If the user gives you a current reading and a target, calculate the exact dose needed.

---

## Chemical Safety Rules

- NEVER mix trichlor and calcium hypochlorite — explosive reaction
- NEVER mix any two sanitisers
- Always add acid to water, never water to acid
- Add cal-hypo at dusk to prevent UV degradation
- Pre-dissolve cal-hypo in a bucket before adding to pool
- Wear PPE when handling acids and oxidisers
- Store chemicals separately, cool, dry, and away from each other

---

## Filter & Equipment

**Backwash procedure:**
1. Turn off pump
2. Set valve to BACKWASH
3. Run until sight glass clears (~2 minutes)
4. Turn off pump, set valve to RINSE
5. Run 30 seconds to seat the sand bed
6. Return to FILTER, restart pump
7. Note new pressure reading

**Low pressure warning (below baseline):** Usually means air leak on suction side, blocked skimmer basket, or pump cavitating. Not a normal state — investigate.

**Turnover rule:** Full pool volume should turn over at least twice per day. For 68,000L at 15–20 m³/hr, that means running the pump at least 8 hours/day.

---

## Common Problems & Fixes

**Green / algae water:**
- Brush all surfaces first
- Adjust pH to 7.2
- Raise FC to 10× CYA level (e.g. CYA=40 → target FC=40 ppm)
- Run filter 24/7, backwash every 6–8 hours
- Vacuum dead algae to WASTE, not return
- Rebalance after clear

**Cloudy / milky water:**
- Check and lower pH
- Run filter continuously
- Add clarifier or floc
- Check calcium — if > 500 ppm, partial drain needed

**Chlorine smell / eye irritation (chloramines):**
- Test combined chlorine — if > 0.5 ppm, shock required
- Dose to 10× combined chlorine level
- Check pH is in range

**pH keeps dropping:** Low alkalinity is usually the cause. Raise TA to 100–120 ppm first, then adjust pH.

**pH keeps rising:** Often caused by aeration (fountains, waterfalls) or high TA. Reduce TA to 80–90 ppm range.

**Chlorine won't hold:** Check CYA — if below 30 ppm, chlorine has no UV protection. Add stabiliser. Also check pH — above 7.6, chlorine effectiveness drops sharply.

---

## Procedures

**Daily:** Test FC and pH. Visual inspection. Check equipment running. Skim if needed. Log readings. Take end-of-shift photo.

**2–3× per week:** Full test — FC, CC, pH, TA, Ca, CYA, temperature. Collect sample at elbow depth (30–45cm), away from inlets.

**Shocking:** Adjust pH to 7.2 first. Add after sunset. Run pump 8+ hours. Don't allow swimming until FC drops below 5 ppm.

**End of shift:** Photograph gauge panel, dosing reservoir levels, and water surface from a consistent position. Timestamp is required.

---

## How to Respond

- Be direct and practical — this is field work, not a chemistry class
- If given a reading, assess it immediately against the target ranges above
- If asked for a dose, calculate it precisely for 68,000 litres
- Flag anything that needs urgent action clearly
- If something sounds like a safety issue (mixed chemicals, very low FC, very high CC), say so plainly
- Keep answers concise unless the user asks for detail
`;

/**
 * Most recent known ORP for a prompt, labeled with its age when stale so
 * a value a controller poll happened to omit this cycle is never presented
 * to the model as if it were this instant's reading (see getMostRecentOrp).
 * Always computed at call time, not render time — "now" has to be when the
 * prompt is actually built.
 */
export function formatOrpForPrompt(history: Reading[]): string {
  const recentOrp = getMostRecentOrp(history);
  if (recentOrp == null) return 'not measured';
  const stale = isOrpStale(recentOrp.at);
  return `${recentOrp.value}${stale ? ` (last measured ${formatAge(recentOrp.at)} — may not reflect current conditions)` : ''}`;
}

const fmt = (v: number | null | undefined) => (v == null ? 'not measured' : String(v));

/** Display name for the provider that actually answered (Gemini, or a fallback). */
export function providerLabel(provider: string): string {
  switch (provider) {
    case 'gemini': return 'Gemini';
    case 'claude': return 'Claude';
    case 'openai': return 'OpenAI';
    default: return 'AI';
  }
}

export async function requestAiProtocol(latestReading: Reading, history: Reading[]): Promise<AiProtocol> {
  const lsi = calculateLSI(latestReading);

  // Auto-synced controller readings (every 15 min, see sync.ts) all carry
  // a boilerplate "Auto-logged from <source>" note. Filtering those out
  // before the slice(0, 5) keeps this list to genuine manual maintenance
  // notes instead of letting a few hours of polling evict them. Only
  // untouched boilerplate is excluded — an operator amending an
  // auto-synced reading's note still surfaces here.
  const recentNotes = history
    .filter((r) => r.notes && !isAutoSyncBoilerplateNote(r.notes))
    .slice(0, 5)
    .map((r) => `[${r.timestamp.toLocaleDateString()}] ${r.notes}`)
    .join('\n');

  const prompt = `
    You are an expert pool maintenance system (PoolStatus AI).
    Analyze the following telemetry data:
    - Free Chlorine: ${fmt(latestReading.chlorine)} ppm
    - Total Chlorine: ${fmt(latestReading.totalChlorine)} ppm (combined chlorine = total − free)
    - Sanitisation (ORP): ${formatOrpForPrompt(history)} mV
    - pH Level: ${fmt(latestReading.ph)}
    - Total Alkalinity: ${fmt(latestReading.alkalinity)} ppm
    - Water Temperature: ${fmt(latestReading.temperature)}°C
    - Calcium Hardness: ${fmt(latestReading.calciumHardness)} ppm
    - Cyanuric Acid: ${fmt(latestReading.cyanuricAcid)} ppm
    - Differential Pressure: ${fmt(latestReading.differentialPressure)} kPa
    - Calculated LSI: ${lsi == null ? 'not computable (missing inputs)' : lsi}

    RECENT MAINTENANCE HISTORY:
    ${recentNotes || 'No recent maintenance recorded.'}

    Provide a technical assessment and a step-by-step checklist of actions in the recommended order.
    Also, provide a "Target Telemetry" section showing exactly what the readings (Chlorine, pH, Alkalinity, LSI) should be after these actions are completed and the water has stabilized.

    IMPORTANT: If the user has already added chemicals (based on history), adjust your advice. Do not repeat steps already taken if the readings haven't had time to stabilize.

    Dosing rule: the operator has not given product type, product strength, occupancy, or circulation status. So any step that adds a chemical must (a) name the product and strength it assumes, (b) state the dose is for 68,000 litres and must be checked against the product label, and (c) be preceded by a checklist step to confirm the pool is unoccupied, circulation is running, and the product's actual type and strength. If you cannot write those, give verification and retesting steps only.
  `;

  const response = await callAiWithFallback({
    model: PROTOCOL_MODEL,
    contents: prompt,
    config: {
      systemInstruction: POOL_SYSTEM_PROMPT,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          analysis: { type: Type.STRING, description: 'Technical assessment of the pool health and LSI analysis in markdown.' },
          checklist: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                title: { type: Type.STRING, description: 'Actionable maintenance step with specific metric amounts.' },
              },
              required: ['id', 'title'],
            },
          },
          expectedOutcome: { type: Type.STRING, description: 'Target telemetry values (Chlorine, pH, Alkalinity, LSI) after the protocol is executed and stabilized.' },
        },
        required: ['analysis', 'checklist', 'expectedOutcome'],
      },
    },
  }, process.env.GEMINI_API_KEY!);

  const data = JSON.parse(response.text || '{}') as Partial<Pick<AiProtocol, 'analysis' | 'checklist' | 'expectedOutcome'>>;
  return {
    analysis: typeof data.analysis === 'string' ? data.analysis : 'No assessment generated.',
    checklist: Array.isArray(data.checklist) ? data.checklist.filter((s) => s && typeof s.title === 'string').map((s, i) => ({ id: String(s.id ?? i + 1), title: s.title })) : [],
    expectedOutcome: typeof data.expectedOutcome === 'string' ? data.expectedOutcome : 'N/A',
    model: providerLabel(response.provider),
    generatedAt: new Date(),
  };
}

/** Checklist steps as the isAI tasks handleExecuteProtocol (App.tsx) writes. */
export function protocolToTasks(protocol: AiProtocol): MaintenanceTask[] {
  const stamp = Date.now();
  return protocol.checklist.map((step) => ({
    id: `ai-${stamp}-${step.id}`,
    title: step.title,
    completed: false,
    isAI: true,
    priority: 'high',
    frequency: 'once',
    uid: '', // set in App.tsx
    createdAt: new Date(),
  }));
}

/**
 * First sentence-ish headline of the analysis for the dashboard card —
 * the full markdown lives in the assistant sheet. Strips markdown
 * emphasis/heading markers so the card reads as plain prose.
 */
export function protocolHeadline(protocol: AiProtocol, maxChars = 220): string {
  const plain = protocol.analysis
    .replace(/[#*_`>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (plain.length <= maxChars) return plain;
  const cut = plain.slice(0, maxChars);
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '));
  return (lastStop > maxChars * 0.5 ? cut.slice(0, lastStop + 1) : cut.trimEnd() + '…');
}
