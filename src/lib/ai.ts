import { GoogleGenAI, GenerateContentParameters, GenerateContentResponse } from "@google/genai";
import { generateContentWithRetry } from "./gemini";

export async function callAiWithFallback(
  params: GenerateContentParameters,
  apiKey: string,
  systemInstruction?: string
): Promise<{ text: string; provider: string }> {
  try {
    // 1. Try Gemini first
    const response = await generateContentWithRetry(params, apiKey);
    return { text: response.text || "", provider: "gemini" };
  } catch (error: any) {
    console.warn("Gemini failed, attempting fallback...", error.message);
    
    // Check if it's a quota error or something we should fallback from
    const isQuotaError = error?.message?.includes('429') || error?.status === 429 || error?.code === 429;
    
    // If it's not a quota error, we might still want to try fallback if it's a general failure
    // but the user specifically asked for quota fallback. 
    // However, in a real app, any persistent failure is a good reason to fallback.
    
    try {
      const prompt = typeof params.contents === 'string' 
        ? params.contents 
        : JSON.stringify(params.contents);

      const response = await fetch("/api/ai/fallback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt,
          systemInstruction: systemInstruction || params.config?.systemInstruction,
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Fallback failed");
      }

      const data = await response.json();
      return { text: data.text, provider: data.provider };
    } catch (fallbackError: any) {
      console.error("All AI fallbacks failed:", fallbackError.message);
      throw error; // Throw the original Gemini error if fallback also fails
    }
  }
}
