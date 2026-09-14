import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";
import { runAiFallback } from "./api/_lib/aiFallback";
import mcpHandler from "./api/mcp";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.set("trust proxy", 1);
  app.use(express.json());

  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use(limiter);

  // AI Fallback Endpoint
  // Logic lives in api/_lib/aiFallback.ts, shared with the Vercel
  // serverless function at api/ai/fallback.ts so local dev (this Express
  // server) and production (Vercel) behave identically.
  app.post("/api/ai/fallback", async (req, res) => {
    const { prompt, systemInstruction, expectJson, responseSchema } = req.body;
    const result = await runAiFallback(prompt, systemInstruction, {
      expectJson,
      responseSchemaDescription: responseSchema,
    });
    res.status(result.status).json(result.body);
  });

  // Remote MCP endpoint — same handler Vercel runs from api/mcp.ts. The
  // transport itself dispatches on method (POST for JSON-RPC, GET to open
  // a standalone SSE stream, DELETE to end a session) and rejects anything
  // else, so this must accept every method rather than only POST — a
  // GET-only route here would 404/fall through to the Vite dev middleware
  // below instead of reaching the transport, unlike the Vercel deployment
  // (which invokes this handler for any method) and the tests in
  // api/_lib/mcp/server.test.ts, which both exercise GET too.
  app.all("/api/mcp", (req, res) => {
    mcpHandler(req, res).catch((error) => {
      console.error("MCP handler error:", error);
      if (!res.headersSent) res.status(500).json({ error: "Internal error" });
    });
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
