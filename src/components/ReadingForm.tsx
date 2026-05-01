import React, { useState } from 'react';
import {
  Check,
  AlertCircle,
  Thermometer,
  Droplets,
  Activity,
  TrendingUp,
  Save,
  ChevronLeft,
  Gauge,
  Mic,
  MicOff,
  Waves,
  Sun,
  MinusCircle,
} from 'lucide-react';
import { motion } from 'motion/react';
import { GoogleGenAI } from "@google/genai";
import { Reading, DEFAULT_RANGES } from '../types';
import { generateContentWithRetry } from '../lib/gemini';

interface Props {
  onSave: (reading: Omit<Reading, 'id' | 'timestamp'>) => void;
  onCancel: () => void;
}

const NUMERIC_FIELDS = ['chlorine', 'ph', 'alkalinity', 'temperature', 'differentialPressure', 'calciumHardness', 'cyanuricAcid'] as const;
type NumericField = typeof NUMERIC_FIELDS[number];

const FIELD_LABELS: Record<NumericField, string> = {
  chlorine: 'Free Chlorine',
  ph: 'pH Level',
  alkalinity: 'Total Alkalinity',
  temperature: 'Temperature',
  differentialPressure: 'Diff. Pressure',
  calciumHardness: 'Calcium Hardness',
  cyanuricAcid: 'Cyanuric Acid',
};

const INITIAL_NUMERIC: Record<NumericField, number> = {
  chlorine: 1.5,
  ph: 7.4,
  alkalinity: 100,
  temperature: 26,
  differentialPressure: 12,
  calciumHardness: 300,
  cyanuricAcid: 40,
};

export default function ReadingForm({ onSave, onCancel }: Props) {
  const [formData, setFormData] = useState({
    ...INITIAL_NUMERIC,
    notes: '',
    uid: '',
  });

  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isTranscribingNotes, setIsTranscribingNotes] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Tracks fields explicitly modified by the user (manual entry or voice transcription)
  const [touched, setTouched] = useState<Set<NumericField>>(new Set());
  const [showDefaultsWarning, setShowDefaultsWarning] = useState(false);
  const [rawInputs, setRawInputs] = useState<Record<string, string>>(
    () => Object.fromEntries(NUMERIC_FIELDS.map(f => [f, String(INITIAL_NUMERIC[f])]))
  );

  const validate = (name: string, value: number) => {
    const range = DEFAULT_RANGES[name as keyof typeof DEFAULT_RANGES];
    if (value < range.min || value > range.max) {
      return `Out of range (${range.min}-${range.max} ${range.unit})`;
    }
    return '';
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;

    if (type === 'number') {
      setRawInputs(prev => ({ ...prev, [name]: value }));
      setTouched(prev => { const n = new Set(prev); n.add(name as NumericField); return n; });
      setShowDefaultsWarning(false);
      if (value === '' || value.endsWith('.')) {
        // Mid-entry — clear stale error so UI doesn't show an outdated state
        setErrors(prev => ({ ...prev, [name]: '' }));
      } else {
        const parsed = parseFloat(value);
        if (!isNaN(parsed)) {
          setFormData(prev => ({ ...prev, [name]: parsed }));
          setErrors(prev => ({ ...prev, [name]: validate(name, parsed) }));
        }
      }
    } else {
      setFormData(prev => ({ ...prev, [name]: value }));
    }
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    const parsed = parseFloat(value);
    const num = isNaN(parsed) ? 0 : parsed;
    setRawInputs(prev => ({ ...prev, [name]: String(num) }));
    setFormData(prev => ({ ...prev, [name]: num }));
    setErrors(prev => ({ ...prev, [name]: validate(name, num) }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Flush any rawInputs that are still mid-edit (e.g. focused field ending with ".")
    const flushed = { ...formData };
    for (const field of NUMERIC_FIELDS) {
      const parsed = parseFloat(rawInputs[field] ?? '');
      if (!isNaN(parsed)) flushed[field] = parsed;
    }
    // Warn if any measurement fields are still at their pre-filled defaults
    const untouched = NUMERIC_FIELDS.filter(f => !touched.has(f));
    if (untouched.length > 0 && !showDefaultsWarning) {
      setShowDefaultsWarning(true);
      return;
    }
    setShowDefaultsWarning(false);
    onSave(flushed);
  };

  const handleVoiceInput = async (targetField: 'all' | 'notes' = 'all') => {
    const isNotes = targetField === 'notes';
    if (isNotes ? isTranscribingNotes : isTranscribing) return;
    
    if (isNotes) setIsTranscribingNotes(true);
    else setIsTranscribing(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      const audioChunks: Blob[] = [];

      mediaRecorder.ondataavailable = (event) => {
        audioChunks.push(event.data);
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = async () => {
          const base64Audio = (reader.result as string).split(',')[1];
          
          const response = await generateContentWithRetry({
            model: "gemini-3-flash-preview",
            contents: [
              {
                inlineData: {
                  mimeType: "audio/wav",
                  data: base64Audio
                }
              },
              {
                text: isNotes 
                  ? "Transcribe the following pool maintenance observations or chemical additions. Return ONLY the transcribed text."
                  : "Transcribe the following pool reading. Extract values for Chlorine, pH, Alkalinity, Temperature, Pressure, Calcium, and CYA if mentioned. Return ONLY a JSON object with these keys: chlorine, ph, alkalinity, temperature, differentialPressure, calciumHardness, cyanuricAcid, notes."
              }
            ],
            config: {
              responseMimeType: isNotes ? "text/plain" : "application/json"
            }
          }, process.env.GEMINI_API_KEY!);

          try {
            if (isNotes) {
              const text = response.text || '';
              setFormData(prev => ({
                ...prev,
                notes: prev.notes ? `${prev.notes}\n${text}` : text
              }));
            } else {
              const result = JSON.parse(response.text || '{}');
              setFormData(prev => ({
                ...prev,
                ...result,
                notes: result.notes || prev.notes
              }));
              // Keep rawInputs in sync so displayed fields reflect transcribed values
              setRawInputs(prev => {
                const updates: Record<string, string> = {};
                for (const field of NUMERIC_FIELDS) {
                  if (result[field] !== undefined) updates[field] = String(result[field]);
                }
                return { ...prev, ...updates };
              });
              // Mark only the fields returned by transcription as touched
              setTouched(prev => {
                const n = new Set(prev);
                for (const field of NUMERIC_FIELDS) {
                  if (result[field] !== undefined) n.add(field);
                }
                return n;
              });
            }
          } catch (e) {
            console.error("Failed to process transcription", e);
          }
          if (isNotes) setIsTranscribingNotes(false);
          else setIsTranscribing(false);
        };
      };

      mediaRecorder.start();
      setTimeout(() => mediaRecorder.stop(), 5000);
    } catch (err) {
      console.error("Voice input failed", err);
      if (isNotes) setIsTranscribingNotes(false);
      else setIsTranscribing(false);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="fixed inset-0 z-50 bg-bg overflow-y-auto anim-fade-up"
    >
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-10">
        <header className="flex items-center justify-between border-b border-border-dim pb-6">
          <button 
            onClick={onCancel} 
            className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-ink-dim hover:text-accent transition-colors"
          >
            <ChevronLeft size={16} />
            Back to Dashboard
          </button>
          <div className="text-right">
            <h1 className="text-lg font-bold text-ink tracking-tight">New Reading</h1>
            <p className="text-[9px] font-bold uppercase tracking-widest text-ink-dim">Manual Data Entry</p>
          </div>
        </header>

        <form onSubmit={handleSubmit} className="space-y-10 pb-32">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <InputField
              label="Free Chlorine"
              name="chlorine"
              value={rawInputs.chlorine}
              unit="ppm"
              icon={<Droplets size={16} />}
              onChange={handleChange}
              onBlur={handleBlur}
              error={errors.chlorine}
              min={0}
              max={10}
              step="any"
              isDefault={!touched.has('chlorine')}
            />
            <InputField
              label="pH Level"
              name="ph"
              value={rawInputs.ph}
              unit=""
              icon={<Activity size={16} />}
              onChange={handleChange}
              onBlur={handleBlur}
              error={errors.ph}
              min={0}
              max={14}
              step="any"
              isDefault={!touched.has('ph')}
            />
            <InputField
              label="Total Alkalinity"
              name="alkalinity"
              value={rawInputs.alkalinity}
              unit="ppm"
              icon={<TrendingUp size={16} />}
              onChange={handleChange}
              onBlur={handleBlur}
              error={errors.alkalinity}
              min={0}
              max={300}
              step="any"
              isDefault={!touched.has('alkalinity')}
            />
            <InputField
              label="Temperature"
              name="temperature"
              value={rawInputs.temperature}
              unit="°C"
              icon={<Thermometer size={16} />}
              onChange={handleChange}
              onBlur={handleBlur}
              error={errors.temperature}
              min={0}
              max={50}
              step="any"
              isDefault={!touched.has('temperature')}
            />
            <InputField
              label="Diff Pressure"
              name="differentialPressure"
              value={rawInputs.differentialPressure}
              unit="kPa"
              icon={<Gauge size={16} />}
              onChange={handleChange}
              onBlur={handleBlur}
              error={errors.differentialPressure}
              min={0}
              max={500}
              step="any"
              isDefault={!touched.has('differentialPressure')}
            />
            <InputField
              label="Calcium Hardness"
              name="calciumHardness"
              value={rawInputs.calciumHardness}
              unit="ppm"
              icon={<Waves size={16} />}
              onChange={handleChange}
              onBlur={handleBlur}
              error={errors.calciumHardness}
              min={0}
              max={1000}
              step="any"
              isDefault={!touched.has('calciumHardness')}
            />
            <InputField
              label="Cyanuric Acid"
              name="cyanuricAcid"
              value={rawInputs.cyanuricAcid}
              unit="ppm"
              icon={<Sun size={16} />}
              onChange={handleChange}
              onBlur={handleBlur}
              error={errors.cyanuricAcid}
              min={0}
              max={200}
              step="any"
              isDefault={!touched.has('cyanuricAcid')}
            />
          </div>

          <div className="flex items-center gap-4 p-4 bg-bg/40 rounded-xl border border-border-dim">
            <button
              type="button"
              onClick={() => handleVoiceInput('all')}
              disabled={isTranscribing}
              className={`flex items-center gap-3 px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all ${
                isTranscribing ? 'bg-critical text-white animate-pulse' : 'bg-accent/10 text-accent hover:bg-accent/20'
              }`}
            >
              {isTranscribing ? <MicOff size={14} /> : <Mic size={14} />}
              {isTranscribing ? 'Recording...' : 'Voice Input'}
            </button>
            <p className="text-[9px] text-ink-dim italic">
              {isTranscribing ? 'Listening for readings...' : 'Speak your readings (e.g., "Chlorine 1.5, pH 7.4")'}
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <label className="text-[10px] font-bold uppercase tracking-widest text-ink-dim">Maintenance Notes</label>
                <button
                  type="button"
                  onClick={() => handleVoiceInput('notes')}
                  disabled={isTranscribingNotes}
                  className={`p-1 rounded-md transition-all ${
                    isTranscribingNotes ? 'bg-critical text-white animate-pulse' : 'text-accent hover:bg-accent/10'
                  }`}
                  title="Voice Observation"
                >
                  {isTranscribingNotes ? <MicOff size={12} /> : <Mic size={12} />}
                </button>
              </div>
              <span className="text-[9px] font-bold uppercase tracking-widest text-ink-dim/50">Optional</span>
            </div>
            <textarea 
              name="notes"
              value={formData.notes}
              onChange={handleChange}
              placeholder="Record chemical additions or visual observations..."
              className="input bg-[#0d1f38] border-border-dim min-h-[140px] resize-none py-4 text-sm"
            />
          </div>

          <div className="fixed bottom-0 left-0 right-0 p-6 bg-[#060e1a]/95 backdrop-blur-xl border-t border-border-dim">
            <div className="max-w-2xl mx-auto space-y-3">
              {showDefaultsWarning && (() => {
                const untouched = NUMERIC_FIELDS.filter(f => !touched.has(f));
                return (
                  <div className="p-4 rounded-xl bg-warning/10 border border-warning/40">
                    <div className="flex items-center gap-2 mb-2">
                      <AlertCircle size={14} className="text-warning flex-shrink-0" />
                      <span className="text-[10px] font-bold uppercase tracking-widest text-warning">Unsaved field defaults detected</span>
                    </div>
                    <p className="text-xs text-ink-muted mb-3">
                      <strong className="text-ink">{untouched.map(f => FIELD_LABELS[f]).join(', ')}</strong> {untouched.length === 1 ? 'was' : 'were'} not entered — the pre-filled estimate{untouched.length === 1 ? '' : 's'} will be saved and may affect report accuracy.
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setShowDefaultsWarning(false)}
                        className="btn btn-secondary py-2 flex-1"
                      >
                        Review Fields
                      </button>
                      <button
                        type="submit"
                        className="btn btn-primary py-2 flex-1"
                      >
                        <Save size={14} />
                        Save Anyway
                      </button>
                    </div>
                  </div>
                );
              })()}
              {!showDefaultsWarning && (
                <button
                  type="submit"
                  className="btn btn-primary w-full py-5 text-xs font-bold uppercase tracking-[0.2em] gap-3 shadow-2xl shadow-accent/20"
                >
                  <Save size={18} />
                  Commit to Database
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </motion.div>
  );
}

function InputField({ label, name, value, unit, icon, onChange, onBlur, error, min, max, step, isDefault }: any) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-[10px] font-bold uppercase tracking-widest text-ink-dim">{label}</label>
        {error ? (
          <span className="text-[9px] font-bold text-critical uppercase tracking-widest flex items-center gap-1.5">
            <AlertCircle size={10} /> {error}
          </span>
        ) : isDefault ? (
          <span className="text-[9px] font-bold text-ink-dim uppercase tracking-widest flex items-center gap-1.5">
            <MinusCircle size={10} /> Default
          </span>
        ) : (
          <span className="text-[9px] font-bold text-success uppercase tracking-widest flex items-center gap-1.5">
            <Check size={10} /> Nominal
          </span>
        )}
      </div>
      <div className="relative group">
        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-dim group-focus-within:text-accent transition-colors">
          {icon}
        </div>
        <input
          type="number"
          name={name}
          value={value}
          onChange={onChange}
          onBlur={onBlur}
          min={min}
          max={max}
          step={step}
          className={`input bg-[#0d1f38] pl-12 pr-16 py-4 text-sm font-mono ${error ? 'border-critical focus:ring-critical/10' : 'border-border-dim focus:border-accent focus:ring-accent/10'}`}
        />
        <div className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-bold text-ink-dim uppercase tracking-widest">
          {unit}
        </div>
      </div>
    </div>
  );
}
