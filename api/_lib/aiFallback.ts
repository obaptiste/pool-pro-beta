import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

export interface AiFallbackResult {
  status: number;
  body: { text?: string; provider?: string; error?: string };
}

export interface AiFallbackOptions {
  /** Caller expects a single JSON object back (Gemini's responseMimeType: "application/json"). */
  expectJson?: boolean;
  /** Human/JSON-schema-readable description of the required shape, forwarded to providers that don't support Gemini's responseSchema natively. */
  responseSchemaDescription?: string;
}

// Defends against a single oversized request running up provider token
// costs — independent of the per-caller rate limit in api/ai/fallback.ts.
const MAX_PROMPT_LENGTH = 20000;
const MAX_SYSTEM_INSTRUCTION_LENGTH = 20000;
const MAX_RESPONSE_SCHEMA_LENGTH = 5000;

/**
 * Checks `value` against one node of a Gemini-style responseSchema
 * (Type.STRING/NUMBER/INTEGER/BOOLEAN/ARRAY/OBJECT, with `properties`,
 * `required`, and `items`), recursing into object properties and array
 * items. Used to catch a syntactically-valid-JSON response whose fields
 * are the wrong shape — e.g. `checklist: null` passes a presence-only
 * check but still crashes `insight.checklist.length` on the client.
 */
function matchesSchema(value: any, schema: any): boolean {
  if (!schema || typeof schema !== "object") return true;

  switch (schema.type) {
    case "STRING":
      if (typeof value !== "string") return false;
      break;
    case "NUMBER":
    case "INTEGER":
      if (typeof value !== "number" || Number.isNaN(value)) return false;
      break;
    case "BOOLEAN":
      if (typeof value !== "boolean") return false;
      break;
    case "ARRAY":
      if (!Array.isArray(value)) return false;
      if (schema.items) {
        for (const item of value) {
          if (!matchesSchema(item, schema.items)) return false;
        }
      }
      break;
    case "OBJECT":
      if (value == null || typeof value !== "object" || Array.isArray(value)) return false;
      {
        const required: string[] = Array.isArray(schema.required) ? schema.required : [];
        for (const key of required) {
          if (!(key in value)) return false;
        }
        if (schema.properties) {
          for (const key of Object.keys(schema.properties)) {
            if (key in value && !matchesSchema(value[key], schema.properties[key])) {
              return false;
            }
          }
        }
      }
      break;
    default:
      // Unknown/unspecified type node — nothing further to check.
      break;
  }

  return true;
}

/**
 * Unwraps a possible ```json ... ``` fence, checks the result parses as
 * JSON, and — when the caller supplied a responseSchema — validates it
 * against that schema (required keys present, values the right type,
 * recursively). Returns the unwrapped JSON text on success, or null if
 * it doesn't qualify as a usable structured response. A provider that
 * passes syntax but returns the wrong shape (missing/mistyped fields)
 * is rejected here rather than handed back as a false success that
 * crashes the client later.
 */
function extractValidJson(text: string, schemaDescription?: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();

  let parsed: any;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return null;
  }

  if (schemaDescription) {
    try {
      const schema = JSON.parse(schemaDescription);
      if (!matchesSchema(parsed, schema)) {
        return null;
      }
    } catch {
      // Schema description wasn't parseable JSON — fall back to the syntax-only check above.
    }
  }

  return candidate;
}

/**
 * Shared AI fallback chain: Claude -> OpenAI.
 * Used by both the local Express dev server (server.ts) and the Vercel
 * serverless function (api/ai/fallback.ts) so production and local dev
 * behave identically.
 */
export async function runAiFallback(
  prompt: string | undefined,
  systemInstruction: string | undefined,
  options: AiFallbackOptions = {}
): Promise<AiFallbackResult> {
  // The TypeScript parameter types only describe the happy path — this is
  // a public HTTP endpoint parsing an untrusted JSON body, and nothing
  // stops a direct caller from sending e.g. prompt: [{"type":"text","text":
  // "<huge text>"}] instead of a string. Anthropic's SDK accepts an array
  // of content blocks as message/system content, so that would sail past
  // the .length checks below (array length, not character count) and get
  // forwarded — and billed — in full. Reject anything that isn't actually
  // a string before measuring or using it.
  if (typeof prompt !== "string" || prompt.length === 0) {
    return { status: 400, body: { error: "Prompt is required" } };
  }
  if (systemInstruction !== undefined && typeof systemInstruction !== "string") {
    return { status: 400, body: { error: "systemInstruction must be a string" } };
  }

  const { expectJson, responseSchemaDescription } = options;

  if (responseSchemaDescription !== undefined && typeof responseSchemaDescription !== "string") {
    return { status: 400, body: { error: "responseSchema must be a string" } };
  }

  if (
    prompt.length > MAX_PROMPT_LENGTH ||
    (systemInstruction?.length ?? 0) > MAX_SYSTEM_INSTRUCTION_LENGTH ||
    (responseSchemaDescription?.length ?? 0) > MAX_RESPONSE_SCHEMA_LENGTH
  ) {
    return { status: 413, body: { error: "Request too large" } };
  }

  // Gemini's structured-output contract (responseSchema/responseMimeType)
  // doesn't carry over to Claude or OpenAI automatically — callers that
  // need JSON back must say so explicitly here, or a plain fallback
  // returns prose that breaks JSON.parse() on the client. Applied to
  // both providers' system instruction so neither silently drops it.
  const effectiveSystemInstruction = expectJson
    ? [
        systemInstruction,
        "IMPORTANT: Respond with ONLY a single valid JSON object. No markdown code fences, no prose before or after the JSON.",
        responseSchemaDescription ? `The JSON must match this shape: ${responseSchemaDescription}` : null,
      ]
        .filter(Boolean)
        .join("\n\n")
    : systemInstruction;

  // 1. Try Claude (Anthropic)
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      console.log("Attempting Claude fallback...");
      const anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });

      const message = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        system: effectiveSystemInstruction,
        messages: [{ role: "user", content: prompt }],
      });

      const content = message.content[0];
      if (content.type === "text") {
        if (expectJson) {
          const validJson = extractValidJson(content.text, responseSchemaDescription);
          if (validJson == null) {
            throw new Error("Claude fallback did not return valid JSON matching the required shape");
          }
          return { status: 200, body: { text: validJson, provider: "claude" } };
        }
        return { status: 200, body: { text: content.text, provider: "claude" } };
      }
    } catch (error: any) {
      console.error("Claude fallback failed:", error.message);
      // Fall through and try ChatGPT below.
    }
  }

  // 2. Try ChatGPT (OpenAI)
  if (process.env.OPENAI_API_KEY) {
    try {
      console.log("Attempting ChatGPT fallback...");
      const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });

      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: effectiveSystemInstruction || "You are a helpful assistant." },
          { role: "user", content: prompt },
        ],
        // Matches the Claude branch's max_tokens: 4096 — without an
        // explicit cap here, a direct caller could ask for a response up
        // to the model's own output limit, so the input-size/rate-limit
        // guards elsewhere wouldn't bound the paid output of a single call.
        max_tokens: 4096,
        // Only force JSON mode when the caller actually asked for structured
        // output — forcing it on a plain-text request (e.g. Dashboard's
        // one-sentence LSI recommendation) would hand back a serialized
        // JSON envelope where the UI renders response.text verbatim.
        ...(expectJson ? { response_format: { type: "json_object" as const } } : {}),
      });

      const text = completion.choices[0].message.content ?? "";
      if (expectJson) {
        const validJson = extractValidJson(text, responseSchemaDescription);
        if (validJson == null) {
          throw new Error("OpenAI fallback did not return valid JSON matching the required shape");
        }
        return { status: 200, body: { text: validJson, provider: "openai" } };
      }
      return { status: 200, body: { text, provider: "openai" } };
    } catch (error: any) {
      console.error("ChatGPT fallback failed:", error.message);
    }
  }

  return { status: 503, body: { error: "All AI providers failed or are unconfigured." } };
}
