import { runAiFallback } from "../_lib/aiFallback";
import { isRateLimited } from "../_lib/rateLimit";

// This endpoint calls out to the app's own paid Anthropic/OpenAI accounts,
// so an unauthenticated caller hammering it directly (bypassing the UI)
// can run up provider bills and starve real users of quota. Throttle by
// caller IP; see rateLimit.ts for the caveats of doing this in-memory on
// a serverless function.
const RATE_LIMIT = 20; // requests
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

// Minimal structural types for the Vercel Node.js request/response objects.
// Avoids taking a dependency on @vercel/node purely for type declarations —
// Vercel's Node runtime augments the request/response with these helpers
// regardless of whether the type package is installed.
interface VercelLikeRequest {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: {
    prompt?: string;
    systemInstruction?: string;
    expectJson?: boolean;
    responseSchema?: string;
  };
}

interface VercelLikeResponse {
  status(code: number): VercelLikeResponse;
  json(body: unknown): void;
}

function getClientIp(req: VercelLikeRequest): string {
  const forwarded = req.headers?.["x-forwarded-for"];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return value?.split(",")[0]?.trim() || "unknown";
}

export default async function handler(req: VercelLikeRequest, res: VercelLikeResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (isRateLimited(getClientIp(req), RATE_LIMIT, RATE_LIMIT_WINDOW_MS)) {
    res.status(429).json({ error: "Too many requests — please slow down and try again shortly." });
    return;
  }

  const { prompt, systemInstruction, expectJson, responseSchema } = req.body ?? {};
  const result = await runAiFallback(prompt, systemInstruction, {
    expectJson,
    responseSchemaDescription: responseSchema,
  });
  res.status(result.status).json(result.body);
}
