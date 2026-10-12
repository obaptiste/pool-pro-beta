import React, { useEffect, useRef, useState } from 'react';
import { Activity, CheckCircle2, ChevronLeft, ChevronRight, Download, FileText, Loader2, MapPin, Mic, MicOff, Send, Sparkles, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import { Reading } from '../types';
import { callAiWithFallback } from '../lib/ai';
import { AiProtocol, POOL_SYSTEM_PROMPT, PROTOCOL_ERROR_MESSAGE, ProtocolState, formatOrpForPrompt } from '../lib/aiProtocol';
import { buildSupplySearchUrl, getSupplySearchLocation } from '../lib/supplySearch';

/** Which panel the assistant sheet is showing; null means closed. */
export type AssistantMode = 'menu' | 'protocol' | 'maps' | 'answer';

interface Props {
  latestReading?: Reading;
  history: Reading[];
  /** Controlled: App owns this so the dashboard's protocol card can deep-link into 'protocol'. */
  mode: AssistantMode | null;
  onModeChange: (mode: AssistantMode | null) => void;
  protocol: AiProtocol | null;
  protocolState: ProtocolState;
  onRequestProtocol: () => void;
  onExecuteProtocol: () => Promise<void> | void;
  onAddToReport?: (entry: { timestamp: string; summary: string }) => void;
  /** Hide the floating button (e.g. while a full-screen form is open). */
  hidden?: boolean;
}

// Minimal typing for the (prefixed on WebKit) Web Speech API.
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;
const getSpeechRecognition = (): SpeechRecognitionCtor | null => {
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

const QUICK_ACTION = 'h-12 rounded-[10px] bg-surface-2 border border-border-dim flex items-center justify-center gap-2 text-[10px] font-bold tracking-[0.12em] uppercase text-white active:scale-95 transition-transform disabled:opacity-50';
const FOOTER_BTN = 'min-h-11 py-2.5 px-3 rounded-[10px] bg-surface-2 border border-border-dim text-[10px] font-bold uppercase tracking-[0.12em] text-ink-muted hover:text-white transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed';

/**
 * Floating AI assistant: a 60 px FAB bottom-right that opens a sheet
 * anchored above the tab bar. Quick actions run the shared AI protocol
 * (owned by App.tsx, also shown on the dashboard's protocol card) and the
 * supply locator; the input asks a free-form question against the pool
 * system prompt, with voice dictation where the browser offers it.
 */
export default function GeminiAssistant({ latestReading, history, mode, onModeChange, protocol, protocolState, onRequestProtocol, onExecuteProtocol, onAddToReport, hidden }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<string | null>(null);
  const [mapsContent, setMapsContent] = useState<string | null>(null);
  const [mapsSearchUrl, setMapsSearchUrl] = useState(buildSupplySearchUrl());
  const [mapsLocationFound, setMapsLocationFound] = useState(false);
  const [protocolStaged, setProtocolStaged] = useState(false);
  const [addedToReport, setAddedToReport] = useState(false);
  const [question, setQuestion] = useState('');
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const speechSupported = typeof window !== 'undefined' && getSpeechRecognition() != null;

  const isOpen = mode != null;
  const close = () => onModeChange(null);

  useEffect(() => () => recognitionRef.current?.stop(), []);

  const toggleListening = () => {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const Ctor = getSpeechRecognition();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = navigator.language || 'en-GB';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      const transcript = e.results[0]?.[0]?.transcript ?? '';
      if (transcript) setQuestion((q) => (q ? `${q} ${transcript}` : transcript));
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recognitionRef.current = rec;
    setListening(true);
    rec.start();
  };

  const analyzeReadings = () => {
    onModeChange('protocol');
    onRequestProtocol();
  };

  const executeProtocol = async () => {
    if (!protocol) return;
    await onExecuteProtocol();
    setProtocolStaged(true);
    setTimeout(() => {
      setProtocolStaged(false);
      onModeChange(null);
    }, 2500);
  };

  const buildReportSummary = () => {
    if (!protocol || !latestReading) return '';
    const fmt = (v: number | null | undefined) => (v == null ? '—' : String(v));
    const checklist = protocol.checklist.map((item, idx) => `${idx + 1}. ${item.title}`).join(' | ');
    return [
      `AI Analysis (${new Date().toLocaleString()})`,
      `Reading: Cl ${fmt(latestReading.chlorine)} ppm, ORP ${formatOrpForPrompt(history)} mV, pH ${fmt(latestReading.ph)}, TA ${fmt(latestReading.alkalinity)} ppm, Temp ${fmt(latestReading.temperature)}°C`,
      `Assessment: ${protocol.analysis.replace(/\n+/g, ' ').trim()}`,
      `Checklist: ${checklist}`,
      `Target Outcome: ${protocol.expectedOutcome.replace(/\n+/g, ' ').trim()}`,
    ].join(' — ');
  };

  const addToReport = () => {
    if (!protocol || !onAddToReport) return;
    onAddToReport({ timestamp: new Date().toISOString(), summary: buildReportSummary() });
    setAddedToReport(true);
    setTimeout(() => setAddedToReport(false), 2200);
  };

  const exportSnapshot = () => {
    if (!protocol || !latestReading) return;
    const fmt = (v: number | null | undefined) => (v == null ? 'not measured' : String(v));
    const report = [
      '# PoolStatus AI Telemetry Snapshot',
      `Generated: ${new Date().toLocaleString()}`,
      '',
      '## Current Reading',
      `- Free Chlorine: ${fmt(latestReading.chlorine)} ppm`,
      `- Sanitisation (ORP): ${formatOrpForPrompt(history)} mV`,
      `- pH: ${fmt(latestReading.ph)}`,
      `- Alkalinity: ${fmt(latestReading.alkalinity)} ppm`,
      `- Temperature: ${fmt(latestReading.temperature)}°C`,
      `- Differential Pressure: ${fmt(latestReading.differentialPressure)} kPa`,
      '',
      '## Health Assessment',
      protocol.analysis,
      '',
      '## Suggested Checklist',
      ...protocol.checklist.map((item, idx) => `${idx + 1}. ${item.title}`),
      '',
      '## Target Telemetry',
      protocol.expectedOutcome,
    ].join('\n');

    const blob = new Blob([report], { type: 'text/markdown;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = `pool_ai_snapshot_${new Date().toISOString().replace(/[:.]/g, '-')}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const findPoolSupplies = async () => {
    onModeChange('maps');
    setLoading(true);
    setError(null);
    setMapsContent(null);
    // Clear any previous search's link/location state so the fallback shown
    // while this lookup is pending doesn't reuse stale results.
    setMapsSearchUrl(buildSupplySearchUrl());
    setMapsLocationFound(false);

    const location = await getSupplySearchLocation(navigator.geolocation);
    setMapsSearchUrl(buildSupplySearchUrl(location));
    setMapsLocationFound(Boolean(location));

    try {
      const response = await callAiWithFallback({
        model: 'gemini-2.5-flash',
        contents: location
          ? 'Find nearby pool supply stores. List current addresses and ratings, and tell me to verify stock before travelling.'
          : 'Find pool supply stores near the user. List current addresses and ratings, and tell me to verify stock before travelling.',
        config: {
          tools: [{ googleMaps: {} }],
          toolConfig: location ? { retrievalConfig: { latLng: location } } : undefined,
        },
      }, process.env.GEMINI_API_KEY!);
      setMapsContent(response.text || 'No stores found.');
    } catch (err) {
      console.error('Maps Error:', err);
      setMapsContent("Live store details aren't available in PoolStatus right now. Open Google Maps below to see current nearby results instead.");
    } finally {
      setLoading(false);
    }
  };

  const askGeneralQuestion = async () => {
    const trimmed = question.trim();
    if (!trimmed || loading) return;
    onModeChange('answer');
    setLoading(true);
    setError(null);
    setAnswer(null);

    try {
      const fmt = (v: number | null | undefined) => (v == null ? 'not measured' : String(v));
      const context = latestReading
        ? `Latest reading context: FC ${fmt(latestReading.chlorine)} ppm, TC ${fmt(latestReading.totalChlorine)} ppm, ORP ${formatOrpForPrompt(history)} mV, pH ${fmt(latestReading.ph)} TA ${fmt(latestReading.alkalinity)} ppm, Temp ${fmt(latestReading.temperature)}°C, CYA ${fmt(latestReading.cyanuricAcid)} ppm.`
        : 'No latest reading is currently available.';
      const response = await callAiWithFallback({
        model: 'gemini-3-flash-preview',
        contents: `${context}\n\nUser question: ${trimmed}\n\nProvide a direct practical answer. If diagnostics are needed, include specific checks in order.`,
        config: { systemInstruction: POOL_SYSTEM_PROMPT },
      }, process.env.GEMINI_API_KEY!);
      setAnswer(response.text || 'No response generated.');
      setQuestion('');
    } catch (err) {
      console.error('General QA Error:', err);
      setError('ERR_QUESTION_FAILED: Unable to answer your question right now.');
    } finally {
      setLoading(false);
    }
  };

  const title = mode === 'protocol' ? 'AI Protocol' : mode === 'maps' ? 'Nearby Supplies' : mode === 'answer' ? 'Pool AI' : 'PoolStatus AI';

  return (
    <>
      {!hidden && (
        <button
          type="button"
          onClick={() => onModeChange(isOpen ? null : 'menu')}
          aria-label={isOpen ? 'Close AI assistant' : 'Open AI assistant'}
          aria-expanded={isOpen}
          className="fixed right-5 z-40 w-[60px] h-[60px] rounded-full bg-accent text-primary flex items-center justify-center shadow-[0_20px_40px_rgba(79,195,247,0.25),0_4px_12px_rgba(0,0,0,0.4)] hover:scale-110 active:scale-90 transition-transform no-print"
          style={{ bottom: 'calc(72px + env(safe-area-inset-bottom))' }}
        >
          <Sparkles size={26} aria-hidden="true" />
        </button>
      )}

      <AnimatePresence>
        {isOpen && (
          <motion.div
            key="assistant-sheet"
            role="dialog"
            aria-modal="false"
            aria-label="PoolStatus AI assistant"
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="fixed left-3 right-3 z-[45] mx-auto max-w-2xl rounded-2xl bg-surface border border-accent/30 shadow-[0_20px_40px_rgba(0,0,0,0.5)] p-4 flex flex-col gap-3 max-h-[72vh] no-print"
            style={{ bottom: 'calc(76px + env(safe-area-inset-bottom))' }}
          >
            <header className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-accent min-w-0">
                {mode !== 'menu' ? (
                  <button type="button" onClick={() => onModeChange('menu')} aria-label="Back to assistant menu" className="-m-2 p-2 text-ink-muted hover:text-white"><ChevronLeft size={16} /></button>
                ) : (
                  <Sparkles size={14} aria-hidden="true" />
                )}
                <span className="truncate">{title}</span>
                {mode === 'protocol' && protocol && (
                  <span className="font-mono text-[9px] tracking-[0.1em] text-ink-dim normal-case">· {protocol.model} {protocol.generatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                )}
              </div>
              <button type="button" onClick={close} aria-label="Close" className="-m-2 p-2 text-ink-dim hover:text-white"><X size={16} /></button>
            </header>

            {mode === 'menu' && (
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={analyzeReadings} disabled={!latestReading} className={QUICK_ACTION} title={latestReading ? undefined : 'Log a reading first'}>
                  <Activity size={14} className="text-accent" aria-hidden="true" />Analyze readings
                </button>
                <button type="button" onClick={findPoolSupplies} className={QUICK_ACTION}>
                  <MapPin size={14} className="text-accent" aria-hidden="true" />Find supplies
                </button>
              </div>
            )}

            {mode !== 'menu' && (
              <div className="overflow-y-auto custom-scrollbar flex-1 min-h-0 flex flex-col gap-4 pr-1" aria-live="polite">
                {mode === 'protocol' && (
                  protocolState === 'loading' ? (
                    <Spinner label="AI analyzing saturation..." />
                  ) : protocolState === 'error' ? (
                    <p className="font-mono text-xs text-critical" role="alert">{PROTOCOL_ERROR_MESSAGE}</p>
                  ) : protocol ? (
                    <ProtocolDetail protocol={protocol} />
                  ) : (
                    <p className="text-xs text-ink-dim">No protocol yet — tap Analyze readings.</p>
                  )
                )}

                {mode === 'maps' && (
                  <div className="space-y-4">
                    {loading ? (
                      <Spinner label="Searching nearby suppliers..." />
                    ) : (
                      <div className="markdown-body text-ink-muted text-sm leading-relaxed font-sans">
                        <ReactMarkdown>{mapsContent || ''}</ReactMarkdown>
                      </div>
                    )}
                    <a href={mapsSearchUrl} target="_blank" rel="noreferrer" className="w-full min-h-12 px-4 rounded-xl bg-accent text-primary text-[10px] font-bold uppercase tracking-widest flex items-center justify-center gap-2 hover:brightness-110 transition-all">
                      <MapPin size={15} aria-hidden="true" />
                      Open nearby suppliers in Google Maps
                    </a>
                    <p className="text-[10px] text-ink-dim leading-relaxed">
                      {loading
                        ? 'Locating nearby suppliers… you can open Google Maps directly at any time.'
                        : mapsLocationFound
                          ? 'Using your approximate device location. Call ahead to confirm product stock and concentration.'
                          : 'Location access was unavailable. Google Maps can use your location after it opens.'}
                    </p>
                  </div>
                )}

                {mode === 'answer' && (
                  loading ? (
                    <Spinner label="Thinking..." />
                  ) : error ? (
                    <p className="font-mono text-xs text-critical" role="alert">{error}</p>
                  ) : answer ? (
                    <div className="markdown-body text-ink-muted text-sm leading-relaxed font-sans">
                      <ReactMarkdown>{answer}</ReactMarkdown>
                    </div>
                  ) : null
                )}
              </div>
            )}

            {mode === 'protocol' && protocol && protocolState !== 'loading' && (
              <footer className="flex gap-2 flex-wrap">
                {protocolStaged ? (
                  <div className="flex-1 min-h-11 px-3 rounded-[10px] bg-success/10 border border-success/20 text-emerald-400 text-[10px] font-bold uppercase tracking-widest flex items-center justify-center gap-2">
                    <CheckCircle2 size={14} aria-hidden="true" />Protocol staged — retest in 4–6 h
                  </div>
                ) : addedToReport ? (
                  <div className="flex-1 min-h-11 px-3 rounded-[10px] bg-accent/10 border border-accent/20 text-accent text-[10px] font-bold uppercase tracking-widest flex items-center justify-center gap-2">
                    <CheckCircle2 size={14} aria-hidden="true" />Added to report queue
                  </div>
                ) : (
                  <>
                    <button type="button" onClick={addToReport} disabled={!onAddToReport} className={`${FOOTER_BTN} flex-1`}>
                      <FileText size={14} aria-hidden="true" />Add to report
                    </button>
                    <button type="button" onClick={exportSnapshot} className={FOOTER_BTN} title="Export AI snapshot as markdown" aria-label="Export AI snapshot as markdown">
                      <Download size={14} aria-hidden="true" />
                    </button>
                    {protocolState === 'executed' ? (
                      <div className="flex-1 min-h-11 px-3 rounded-[10px] bg-surface-2 border border-success/35 text-emerald-400 text-[10px] font-bold uppercase tracking-widest flex items-center justify-center gap-2">
                        <CheckCircle2 size={14} aria-hidden="true" />Checklist built
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={executeProtocol}
                        disabled={protocol.checklist.length === 0}
                        className="flex-1 min-h-11 py-2.5 px-3 rounded-[10px] bg-accent text-primary text-[10px] font-bold uppercase tracking-[0.12em] whitespace-nowrap hover:brightness-110 transition-all flex items-center justify-center gap-2 disabled:opacity-40"
                      >
                        Execute protocol<ChevronRight size={14} aria-hidden="true" />
                      </button>
                    )}
                  </>
                )}
              </footer>
            )}

            <form
              onSubmit={(e) => { e.preventDefault(); askGeneralQuestion(); }}
              className="h-12 pl-3.5 pr-1.5 rounded-[10px] bg-surface-2 border border-border-dim flex items-center gap-2.5"
            >
              {speechSupported && (
                <button
                  type="button"
                  onClick={toggleListening}
                  aria-label={listening ? 'Stop dictation' : 'Dictate a question'}
                  aria-pressed={listening}
                  className={`-ml-1.5 p-1.5 rounded-md ${listening ? 'text-red-400 animate-pulse' : 'text-accent'}`}
                >
                  {listening ? <MicOff size={16} /> : <Mic size={16} />}
                </button>
              )}
              <input
                type="text"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder={listening ? 'Listening…' : 'Ask about the pool…'}
                aria-label="Ask about the pool"
                className="flex-1 min-w-0 bg-transparent border-0 outline-none text-[13px] text-white placeholder:text-ink-dim"
              />
              <button
                type="submit"
                disabled={loading || !question.trim()}
                aria-label="Ask Pool AI"
                className="w-9 h-9 rounded-lg bg-accent text-primary flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 transition-transform"
              >
                {loading && mode === 'answer' ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-8 text-ink-dim">
      <Loader2 size={20} className="text-accent animate-spin" aria-hidden="true" />
      <p className="text-[10px] font-bold uppercase tracking-widest">{label}</p>
    </div>
  );
}

function ProtocolDetail({ protocol }: { protocol: AiProtocol }) {
  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-accent mb-2">Health Assessment</h3>
        <div className="markdown-body text-ink-muted text-sm leading-relaxed font-sans">
          <ReactMarkdown>{protocol.analysis}</ReactMarkdown>
        </div>
      </section>
      <section>
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-accent mb-2">Suggested Checklist</h3>
        {protocol.checklist.length > 0 ? (
          <ol className="space-y-2">
            {protocol.checklist.map((item, idx) => (
              <li key={item.id} className="flex items-start gap-3 p-3 bg-surface-2 rounded-xl border border-border-dim/60">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-accent/10 text-accent text-[10px] font-bold flex items-center justify-center border border-accent/20">{idx + 1}</span>
                <span className="text-sm text-ink">{item.title}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-xs text-ink-dim">No action checklist generated for this response.</p>
        )}
      </section>
      {protocol.expectedOutcome !== 'N/A' && (
        <section className="p-4 bg-accent/5 rounded-xl border border-accent/10">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-accent mb-2">Target Telemetry (Post-Protocol)</h3>
          <div className="markdown-body text-ink-muted text-xs leading-relaxed font-sans italic">
            <ReactMarkdown>{protocol.expectedOutcome}</ReactMarkdown>
          </div>
        </section>
      )}
    </div>
  );
}
