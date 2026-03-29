import React, { useState } from 'react';
import { Sparkles, Loader2, Volume2, X, ChevronRight, Terminal, MapPin } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI } from "@google/genai";
import ReactMarkdown from 'react-markdown';
import { Reading, DEFAULT_RANGES, MaintenanceTask } from '../types';
import { generateContentWithRetry } from '../lib/gemini';
import { callAiWithFallback } from '../lib/ai';
import { Type } from "@google/genai";

interface Props {
  latestReading?: Reading;
  history: Reading[];
  onExecuteProtocol: (tasks: MaintenanceTask[]) => void;
}

interface AIResponse {
  analysis: string;
  checklist: { id: string; title: string }[];
  expectedOutcome: string;
}

export default function GeminiAssistant({ latestReading, history, onExecuteProtocol }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [insight, setInsight] = useState<AIResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isFindingSupplies, setIsFindingSupplies] = useState(false);
  const [isMapsMode, setIsMapsMode] = useState(false);
  const [mapsContent, setMapsContent] = useState<string | null>(null);

  const calculateLSI = (reading: Reading) => {
    const getTF = (temp: number) => {
      if (temp < 10) return 0.3;
      if (temp < 15) return 0.4;
      if (temp < 20) return 0.5;
      if (temp < 25) return 0.6;
      if (temp < 30) return 0.7;
      if (temp < 35) return 0.8;
      return 0.9;
    };
    const getCF = (ch: number) => {
      if (ch < 100) return 1.6;
      if (ch < 150) return 1.8;
      if (ch < 200) return 1.9;
      if (ch < 250) return 2.0;
      if (ch < 300) return 2.1;
      if (ch < 400) return 2.2;
      if (ch < 500) return 2.3;
      return 2.4;
    };
    const getAF = (alk: number) => {
      if (alk < 100) return 2.0;
      if (alk < 150) return 2.2;
      if (alk < 200) return 2.3;
      if (alk < 300) return 2.5;
      return 2.6;
    };
    return parseFloat((reading.ph + getTF(reading.temperature) + getCF(reading.calciumHardness) + getAF(reading.alkalinity) - 12.1).toFixed(2));
  };

  const getInsight = async () => {
    if (!latestReading) return;
    setIsOpen(true);
    setLoading(true);
    setError(null);
    setIsMapsMode(false);
    
    try {
      const lsi = calculateLSI(latestReading);
      
      const recentNotes = history
        .slice(0, 5)
        .filter(r => r.notes)
        .map(r => `[${r.timestamp.toLocaleDateString()}] ${r.notes}`)
        .join('\n');

      const prompt = `
        You are an expert pool maintenance system (PoolStatus AI). 
        Analyze the following telemetry data:
        - Free Chlorine: ${latestReading.chlorine} ppm
        - pH Level: ${latestReading.ph}
        - Total Alkalinity: ${latestReading.alkalinity} ppm
        - Water Temperature: ${latestReading.temperature}°C
        - Calcium Hardness: ${latestReading.calciumHardness} ppm
        - Cyanuric Acid: ${latestReading.cyanuricAcid} ppm
        - Differential Pressure: ${latestReading.differentialPressure} kPa
        - Calculated LSI: ${lsi}
        
        RECENT MAINTENANCE HISTORY:
        ${recentNotes || 'No recent maintenance recorded.'}

        Provide a technical assessment and a step-by-step checklist of actions in the recommended order.
        Also, provide a "Target Telemetry" section showing exactly what the readings (Chlorine, pH, Alkalinity, LSI) should be after these actions are completed and the water has stabilized.
        
        IMPORTANT: If the user has already added chemicals (based on history), adjust your advice. Do not repeat steps already taken if the readings haven't had time to stabilize.
      `;

      const response = await callAiWithFallback({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              analysis: {
                type: Type.STRING,
                description: "Technical assessment of the pool health and LSI analysis in markdown."
              },
              checklist: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    title: { type: Type.STRING, description: "Actionable maintenance step with specific metric amounts." }
                  },
                  required: ["id", "title"]
                }
              },
              expectedOutcome: {
                type: Type.STRING,
                description: "Target telemetry values (Chlorine, pH, Alkalinity, LSI) after the protocol is executed and stabilized."
              }
            },
            required: ["analysis", "checklist", "expectedOutcome"]
          }
        }
      }, process.env.GEMINI_API_KEY!);

      const data = JSON.parse(response.text || '{}') as AIResponse;
      setInsight(data);
    } catch (error) {
      console.error("AI Error:", error);
      setError("ERR_ANALYSIS_FAILED: Unable to process telemetry data.");
    } finally {
      setLoading(false);
    }
  };

  const executeProtocol = () => {
    if (!insight) return;
    
    const tasks: MaintenanceTask[] = insight.checklist.map(item => ({
      id: `ai-${Date.now()}-${item.id}`,
      title: item.title,
      completed: false,
      isAI: true,
      priority: 'high',
      frequency: 'once',
      uid: '', // Will be set in App.tsx
      createdAt: new Date()
    }));

    onExecuteProtocol(tasks);
    setIsOpen(false);
    alert("Protocol Staged: The AI-generated maintenance checklist has been added to your dashboard. Please complete these actions in order and log a new reading once the water has stabilized (approx. 4-6 hours).");
  };

  const findPoolSupplies = async () => {
    setIsFindingSupplies(true);
    setIsOpen(true);
    setLoading(true);
    setIsMapsMode(true);
    setError(null);
    try {
      const response = await callAiWithFallback({
        model: "gemini-3-flash-preview",
        contents: "Find the best rated pool supply stores near me and list their addresses and ratings.",
        config: {
          tools: [{ googleMaps: {} }]
        }
      }, process.env.GEMINI_API_KEY!);
      setMapsContent(response.text || "No stores found.");
    } catch (error) {
      console.error("Maps Error:", error);
      setError("ERR_MAPS_FAILED: Unable to retrieve nearby store data.");
    } finally {
      setLoading(false);
      setIsFindingSupplies(false);
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
                ) : error ? (
                  <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-xl text-destructive text-xs font-mono">
                    {error}
                  </div>
                ) : isMapsMode ? (
                  <div className="markdown-body text-ink-muted text-sm leading-relaxed font-sans">
                    <ReactMarkdown>{mapsContent || ''}</ReactMarkdown>
                  </div>
                ) : insight ? (
                  <div className="space-y-8">
                    <section>
                      <h3 className="text-[10px] font-bold uppercase tracking-widest text-accent mb-3">Health Assessment</h3>
                      <div className="markdown-body text-ink-muted text-sm leading-relaxed font-sans">
                        <ReactMarkdown>{insight.analysis}</ReactMarkdown>
                      </div>
                    </section>

                    <section>
                      <h3 className="text-[10px] font-bold uppercase tracking-widest text-accent mb-3">Suggested Checklist</h3>
                      <div className="space-y-2">
                        {insight.checklist.map((item, idx) => (
                          <div key={item.id} className="flex items-start gap-3 p-3 bg-surface rounded-xl border border-border-dim/50">
                            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-accent/10 text-accent text-[10px] font-bold flex items-center justify-center border border-accent/20">
                              {idx + 1}
                            </span>
                            <span className="text-sm text-ink">{item.title}</span>
                          </div>
                        ))}
                      </div>
                    </section>

                    <section className="p-4 bg-accent/5 rounded-xl border border-accent/10">
                      <h3 className="text-[10px] font-bold uppercase tracking-widest text-accent mb-2">Target Telemetry (Post-Protocol)</h3>
                      <div className="markdown-body text-ink-muted text-xs leading-relaxed font-sans italic">
                        <ReactMarkdown>{insight.expectedOutcome}</ReactMarkdown>
                      </div>
                    </section>
                  </div>
                ) : null}
              </div>

              <footer className="p-4 bg-[#060e1a] border-t border-border-dim flex gap-3">
                <button 
                  onClick={findPoolSupplies}
                  className="flex-1 py-3 px-4 rounded-xl bg-surface border border-border-dim text-[10px] font-bold uppercase tracking-widest text-ink-dim hover:text-white transition-all flex items-center justify-center gap-2"
                >
                  <MapPin size={14} />
                  Find Supplies
                </button>
                <button 
                  onClick={executeProtocol}
                  className="flex-1 py-3 px-4 rounded-xl bg-accent text-primary text-[10px] font-bold uppercase tracking-widest hover:brightness-110 transition-all flex items-center justify-center gap-2"
                >
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
