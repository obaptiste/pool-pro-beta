import { runAiFallback } from "../_lib/aiFallback";

// Minimal structural types for the Vercel Node.js request/response objects.
// Avoids taking a dependency on @vercel/node purely for type declarations —
// Vercel's Node runtime augments the request/response with these helpers
// regardless of whether the type package is installed.
interface VercelLikeRequest {
  method?: string;
  body?: { prompt?: string; systemInstruction?: string };
}

interface VercelLikeResponse {
  status(code: number): VercelLikeResponse;
  json(body: unknown): void;
}

export default async function handler(req: VercelLikeRequest, res: VercelLikeResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { prompt, systemInstruction } = req.body ?? {};
  const result = await runAiFallback(prompt, systemInstruction);
  res.status(result.status).json(result.body);
}
