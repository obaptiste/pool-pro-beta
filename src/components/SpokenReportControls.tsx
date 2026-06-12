import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlignLeft, FileText, Pause, Play, Square, Volume2 } from 'lucide-react';

type NarrationType = 'full' | 'summary';

interface Props {
  fullReportText: string;
  summaryReportText: string;
}

// Heights in px for the equaliser bars (purely visual variety)
const BAR_HEIGHTS = [5, 9, 6, 12, 7, 10, 5, 8, 4];

export default function SpokenReportControls({ fullReportText, summaryReportText }: Props) {
  const [isPlaying, setIsPlaying]   = useState(false);
  const [isPaused, setIsPaused]     = useState(false);
  const [activeType, setActiveType] = useState<NarrationType | null>(null);
  // Keep a stable ref so event callbacks always see the latest state
  const activeTypeRef = useRef<NarrationType | null>(null);

  // Cancel any in-progress speech when the component unmounts (e.g. user navigates away)
  useEffect(() => () => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  }, []);

  const stopSpeech = useCallback(() => {
    window.speechSynthesis.cancel();
    setIsPlaying(false);
    setIsPaused(false);
    setActiveType(null);
    activeTypeRef.current = null;
  }, []);

  const speak = useCallback((type: NarrationType) => {
    window.speechSynthesis.cancel();

    const text = type === 'full' ? fullReportText : summaryReportText;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate   = 0.88;
    utterance.pitch  = 1.0;
    utterance.volume = 1.0;

    // Pick a natural-sounding English voice if available
    const voices = window.speechSynthesis.getVoices();
    const preferred =
      voices.find(v =>
        v.lang.startsWith('en') &&
        (v.name.includes('Samantha') ||
         v.name.includes('Daniel') ||
         v.name.includes('Karen') ||
         v.name.includes('Google US English') ||
         v.name.includes('Google UK English Female') ||
         v.name.includes('Alex'))
      ) ??
      voices.find(v => v.lang.startsWith('en')) ??
      voices[0];

    if (preferred) utterance.voice = preferred;

    utterance.onstart = () => {
      setIsPlaying(true);
      setIsPaused(false);
      setActiveType(type);
      activeTypeRef.current = type;
    };

    utterance.onend = () => {
      setIsPlaying(false);
      setIsPaused(false);
      setActiveType(null);
      activeTypeRef.current = null;
    };

    // 'interrupted' is fired when cancel() is called — not a user-visible error
    utterance.onerror = (e) => {
      if (e.error !== 'interrupted' && e.error !== 'canceled') {
        setIsPlaying(false);
        setIsPaused(false);
        setActiveType(null);
        activeTypeRef.current = null;
      }
    };

    window.speechSynthesis.speak(utterance);
  }, [fullReportText, summaryReportText]);

  const pause = useCallback(() => {
    window.speechSynthesis.pause();
    setIsPlaying(false);
    setIsPaused(true);
  }, []);

  const resume = useCallback(() => {
    window.speechSynthesis.resume();
    setIsPlaying(true);
    setIsPaused(false);
  }, []);

  const isActive = isPlaying || isPaused;

  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return null;
  }

  return (
    <div className="rounded-2xl bg-[#0D1F38] border border-[#1E3A5F] p-5 space-y-4 no-print">

      {/* ── Section header ──────────────────────────────────────────────────── */}
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-accent/15 border border-accent/25 flex items-center justify-center flex-shrink-0">
          <Volume2 size={16} className="text-accent" />
        </div>
        <div>
          <h3 className="text-[11px] font-bold uppercase tracking-widest text-white mb-1">
            Audio Briefing
          </h3>
          <p className="text-[10px] text-[#4A6A80] leading-relaxed">
            Prefer to listen? Use the audio briefing controls below to hear either the full
            maintenance report or a short summary.
          </p>
        </div>
      </div>

      {/* ── Now-playing indicator ────────────────────────────────────────────── */}
      {isActive && (
        <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-accent/10 border border-accent/25">
          {isPlaying ? (
            // Animated equaliser bars
            <span
              className="flex items-end gap-[2px]"
              aria-hidden="true"
              style={{ height: 14 }}
            >
              {BAR_HEIGHTS.map((h, i) => (
                <span
                  key={i}
                  className="rounded-sm bg-accent"
                  style={{
                    width: 3,
                    height: h,
                    transformOrigin: 'bottom',
                    animation:
                      typeof window !== 'undefined' &&
                      typeof window.matchMedia === 'function' &&
                      window.matchMedia('(prefers-reduced-motion: reduce)').matches
                        ? 'none'
                        : 'audio-bar 0.75s ease-in-out infinite',
                    animationDelay: `${i * 0.09}s`,
                  }}
                />
              ))}
            </span>
          ) : (
            <span className="w-3 h-3 rounded-full bg-accent/40 border border-accent/60 flex-shrink-0" aria-hidden="true" />
          )}
          <span
            className="text-[10px] font-bold text-accent uppercase tracking-widest"
            aria-live="polite"
            aria-atomic="true"
          >
            {isPlaying
              ? `Now reading: ${activeType === 'full' ? 'Full report' : 'Summary'}`
              : `Paused · ${activeType === 'full' ? 'Full report' : 'Summary'}`}
          </span>
        </div>
      )}

      {/* ── Primary play buttons (always visible) ───────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => speak('full')}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-accent text-primary font-bold text-[10px] uppercase tracking-widest hover:bg-accent/90 transition-all active:scale-95"
          aria-label="Listen to full maintenance report"
          aria-pressed={isPlaying && activeType === 'full'}
        >
          <FileText size={13} aria-hidden="true" />
          Listen to full report
        </button>

        <button
          onClick={() => speak('summary')}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#0A1628] border border-[#1E3A5F] text-[#8AB4CC] font-bold text-[10px] uppercase tracking-widest hover:text-white hover:border-accent/40 transition-all active:scale-95"
          aria-label="Listen to summary report"
          aria-pressed={isPlaying && activeType === 'summary'}
        >
          <AlignLeft size={13} aria-hidden="true" />
          Listen to summary
        </button>
      </div>

      {/* ── Transport controls (pause / resume / stop) ───────────────────────── */}
      {isActive && (
        <div className="flex flex-wrap gap-2">
          {isPlaying ? (
            <button
              onClick={pause}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400 font-bold text-[10px] uppercase tracking-widest hover:bg-amber-500/25 transition-all active:scale-95"
              aria-label="Pause narration"
            >
              <Pause size={13} aria-hidden="true" />
              Pause
            </button>
          ) : (
            <button
              onClick={resume}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-accent/15 border border-accent/30 text-accent font-bold text-[10px] uppercase tracking-widest hover:bg-accent/25 transition-all active:scale-95"
              aria-label="Resume narration"
            >
              <Play size={13} aria-hidden="true" />
              Resume
            </button>
          )}

          <button
            onClick={stopSpeech}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-500/10 border border-red-500/25 text-red-400 font-bold text-[10px] uppercase tracking-widest hover:bg-red-500/20 transition-all active:scale-95"
            aria-label="Stop narration"
          >
            <Square size={13} fill="currentColor" aria-hidden="true" />
            Stop
          </button>
        </div>
      )}
    </div>
  );
}
