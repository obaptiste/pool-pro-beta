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

function extractJsonText(text: string): string | null {
  // Claude sometimes wraps JSON in a ```json ... ``` fence despite being
  // asked not to; unwrap it before validating/handing back to the client.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();
  try {
    JSON.parse(candidate);
    return candidate;
  } catch {
    return null;
  }
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
  // need JSON back must say so explicitly here, or the raw prose a plain
  // fallback returns breaks JSON.parse() on the client.
  const claudeSystemInstruction = expectJson
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
        system: claudeSystemInstruction,
        messages: [{ role: "user", content: prompt }],
      });

      const content = message.content[0];
      if (content.type === "text") {
        if (expectJson) {
          const validJson = extractJsonText(content.text);
          if (validJson == null) {
            throw new Error("Claude fallback did not return valid JSON");
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
          { role: "system", content: systemInstruction || "You are a helpful assistant." },
          { role: "user", content: prompt },
        ],
        // Assuming we want JSON since the app uses it. OpenAI's json_object
        // mode guarantees syntactically valid JSON when requested; when the
        // caller didn't ask for JSON this still forces JSON-shaped prose,
        // matching the pre-existing behavior of this fallback.
        response_format: { type: "json_object" },
      });

      const text = completion.choices[0].message.content ?? "";
      if (expectJson) {
        const validJson = extractJsonText(text);
        if (validJson == null) {
          throw new Error("OpenAI fallback did not return valid JSON");
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
