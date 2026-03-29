import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // AI Fallback Endpoint
  app.post("/api/ai/fallback", async (req, res) => {
    const { prompt, systemInstruction } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: "Prompt is required" });
    }

    // 1. Try Claude (Anthropic)
    if (process.env.ANTHROPIC_API_KEY) {
      try {
        console.log("Attempting Claude fallback...");
        const anthropic = new Anthropic({
          apiKey: process.env.ANTHROPIC_API_KEY,
        });

        const message = await anthropic.messages.create({
          model: "claude-3-5-sonnet-20240620",
          max_tokens: 4096,
          system: systemInstruction,
          messages: [{ role: "user", content: prompt }],
        });

        const content = message.content[0];
        if (content.type === "text") {
          return res.json({ text: content.text, provider: "claude" });
        }
      } catch (error: any) {
        console.error("Claude fallback failed:", error.message);
        // If it's not a quota error, we might still want to try ChatGPT
        // but usually we fallback on any failure if the user wants "fallback"
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

        return res.json({ 
          text: completion.choices[0].message.content, 
          provider: "openai" 
        });
      } catch (error: any) {
        console.error("ChatGPT fallback failed:", error.message);
      }
    }

    res.status(503).json({ error: "All AI providers failed or are unconfigured." });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
