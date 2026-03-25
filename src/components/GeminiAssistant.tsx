import React, { useState } from 'react';
import { Sparkles, Loader2, Volume2, X, ChevronRight, Terminal } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI } from "@google/genai";
import ReactMarkdown from 'react-markdown';
import { Reading, DEFAULT_RANGES } from '../types';

interface Props {
  latestReading?: Reading;
}

export default function GeminiAssistant({ latestReading }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [insight, setInsight] = useState<string | null>(null);

  const getInsight = async () => {
    if (!latestReading) return;
    setLoading(true);
    setIsOpen(true);
    
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      const prompt = `
        You are an expert pool maintenance system (PoolStatus AI). 
        Analyze the following telemetry data:
        - Free Chlorine: ${latestReading.chlorine} ppm (Target: ${DEFAULT_RANGES.chlorine.min}-${DEFAULT_RANGES.chlorine.max})
        - pH Level: ${latestReading.ph} (Target: ${DEFAULT_RANGES.ph.min}-${DEFAULT_RANGES.ph.max})
        - Total Alkalinity: ${latestReading.alkalinity} ppm (Target: ${DEFAULT_RANGES.alkalinity.min}-${DEFAULT_RANGES.alkalinity.max})
        - Water Temperature: ${latestReading.temperature}°C
        - Differential Pressure: ${latestReading.differentialPressure} PSI (Target: ${DEFAULT_RANGES.differentialPressure.min}-${DEFAULT_RANGES.differentialPressure.max})
        
        Provide a technical assessment of the water balance and filter health. 
        Include:
        1. STATUS: A one-sentence summary of overall water health.
        2. ANOMALIES: Identify any readings outside optimal parameters.
        3. PROTOCOL: Specific chemical adjustment steps (e.g., "Add X grams of Y").
        
        Keep it concise, professional, and technical. Use Markdown formatting.
      `;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
      });

      setInsight(response.text || "No telemetry analysis available.");
    } catch (error) {
      console.error("Gemini Error:", error);
      setInsight("ERR_ANALYSIS_FAILED: Unable to process telemetry data.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button 
        onClick={getInsight}
        className="fixed bottom-24 right-6 w-12 h-12 bg-accent text-primary rounded-full shadow-xl shadow-accent/20 flex items-center justify-center hover:scale-110 active:scale-90 transition-all z-40 no-print"
      >
        <Sparkles size={24} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div 
            initial={{ opacity: 0, y: 100, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 100, scale: 0.95 }}
            className="fixed bottom-0 left-0 right-0 z-[80] p-4 no-print"
          >
            <div className="max-w-2xl mx-auto bg-[#0d1f38] rounded-2xl shadow-2xl border border-border-dim overflow-hidden">
              <header className="p-4 border-b border-border-dim flex items-center justify-between bg-[#060e1a]">
                <div className="flex items-center gap-3 text-accent font-bold text-[10px] uppercase tracking-widest">
                  <Terminal size={14} />
                  <span>AI Telemetry Analysis</span>
                </div>
                <button 
                  onClick={() => setIsOpen(false)} 
                  className="p-1.5 hover:bg-surface rounded-lg transition-colors text-ink-dim hover:text-white"
                >
                  <X size={16} />
                </button>
              </header>
              
              <div className="p-6 max-h-[60vh] overflow-y-auto custom-scrollbar">
                {loading ? (
                  <div className="flex flex-col items-center justify-center py-16 space-y-6">
                    <div className="relative">
                      <Loader2 size={40} className="text-accent animate-spin" />
                      <Sparkles size={16} className="text-accent absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 animate-pulse" />
                    </div>
                    <div className="text-center space-y-2">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-ink-dim">Processing Telemetry</p>
                      <p className="text-[9px] font-mono text-ink-dim/50 animate-pulse">Running diagnostic protocols...</p>
                    </div>
                  </div>
                ) : (
                  <div className="markdown-body text-ink-muted text-sm leading-relaxed font-sans">
                    <ReactMarkdown>{insight || ''}</ReactMarkdown>
                  </div>
                )}
              </div>

              <footer className="p-4 bg-[#060e1a] border-t border-border-dim flex gap-3">
                <button className="flex-1 py-3 px-4 rounded-xl bg-surface border border-border-dim text-[10px] font-bold uppercase tracking-widest text-ink-dim hover:text-white transition-all flex items-center justify-center gap-2">
                  <Volume2 size={14} />
                  Audio Output
                </button>
                <button className="flex-1 py-3 px-4 rounded-xl bg-accent text-primary text-[10px] font-bold uppercase tracking-widest hover:brightness-110 transition-all flex items-center justify-center gap-2">
                  Execute Protocol
                  <ChevronRight size={14} />
                </button>
              </footer>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
