import { GoogleGenAI, GenerateContentParameters, GenerateContentResponse } from "@google/genai";

const MAX_RETRIES = 3;
const INITIAL_BACKOFF = 1000; // 1 second

export async function generateContentWithRetry(
  params: GenerateContentParameters,
  apiKey: string
): Promise<GenerateContentResponse> {
  let lastError: any;
  
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent(params);
      return response;
    } catch (error: any) {
      lastError = error;
      
      // Check if it's a rate limit error (429)
      const isRateLimit = error?.message?.includes('429') || error?.status === 429 || error?.code === 429;
      
      if (isRateLimit && attempt < MAX_RETRIES) {
        const backoff = INITIAL_BACKOFF * Math.pow(2, attempt);
        console.warn(`Gemini Rate Limit hit. Retrying in ${backoff}ms (Attempt ${attempt + 1}/${MAX_RETRIES})`);
        await new Promise(resolve => setTimeout(resolve, backoff));
        continue;
      }
      
      throw error;
    }
  }
  
  throw lastError;
}
