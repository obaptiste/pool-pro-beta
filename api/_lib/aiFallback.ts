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

/**
 * Unwraps a possible ```json ... ``` fence, checks the result parses as
 * JSON, and — when the caller told us which top-level keys are required
 * (from Gemini's responseSchema) — checks they're all present. Returns
 * the unwrapped JSON text on success, or null if it doesn't qualify as a
 * usable structured response. A provider that passes syntax but is
 * missing a required key (e.g. `checklist`) is rejected here rather than
 * handed back as a false success that crashes the client later.
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
      const required: string[] = Array.isArray(schema?.required) ? schema.required : [];
      if (parsed == null || typeof parsed !== "object" || !required.every((key) => key in parsed)) {
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
  if (!prompt) {
    return { status: 400, body: { error: "Prompt is required" } };
  }

  if (prompt.length > MAX_PROMPT_LENGTH || (systemInstruction?.length ?? 0) > MAX_SYSTEM_INSTRUCTION_LENGTH) {
    return { status: 413, body: { error: "Request too large" } };
  }

  const { expectJson, responseSchemaDescription } = options;

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
