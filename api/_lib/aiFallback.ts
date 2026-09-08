import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

export interface AiFallbackResult {
  status: number;
  body: { text?: string; provider?: string; error?: string };
}

/**
 * Shared AI fallback chain: Claude -> OpenAI.
 * Used by both the local Express dev server (server.ts) and the Vercel
 * serverless function (api/ai/fallback.ts) so production and local dev
 * behave identically.
 */
export async function runAiFallback(
  prompt: string | undefined,
  systemInstruction: string | undefined
): Promise<AiFallbackResult> {
  if (!prompt) {
    return { status: 400, body: { error: "Prompt is required" } };
  }

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
        system: systemInstruction,
        messages: [{ role: "user", content: prompt }],
      });

      const content = message.content[0];
      if (content.type === "text") {
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
        response_format: { type: "json_object" }, // Assuming we want JSON since the app uses it
      });

      return {
        status: 200,
        body: { text: completion.choices[0].message.content ?? "", provider: "openai" },
      };
    } catch (error: any) {
      console.error("ChatGPT fallback failed:", error.message);
    }
  }

  return { status: 503, body: { error: "All AI providers failed or are unconfigured." } };
}
