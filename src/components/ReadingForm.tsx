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
  CalendarClock
} from 'lucide-react';
import { motion } from 'motion/react';
import { format } from 'date-fns';
import { Reading, DEFAULT_RANGES } from '../types';
import { generateContentWithRetry } from '../lib/gemini';

type ReadingDraft = Omit<Reading, 'id' | 'timestamp' | 'uid'>;

interface Props {
  onSave: (reading: ReadingDraft, timestamp: Date) => void;
  onCancel: () => void;
  initialTimestamp?: Date;
}

export default function ReadingForm({ onSave, onCancel, initialTimestamp }: Props) {
  const isHistoricEntry = initialTimestamp !== undefined;
  const [timestamp, setTimestamp] = useState(() => initialTimestamp ? new Date(initialTimestamp) : new Date());
  const [timestampError, setTimestampError] = useState('');
  const [formData, setFormData] = useState<ReadingDraft>({
    chlorine: 1.5,
    ph: 7.4,
    alkalinity: 100,
    temperature: 26,
    differentialPressure: 12,
    calciumHardness: 300,
    cyanuricAcid: 40,
    notes: '',
  });

  const [isTranscribing, setIsTranscribing] = useState(false);

  const [isTranscribingNotes, setIsTranscribingNotes] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = (name: string, value: number) => {
    const range = DEFAULT_RANGES[name as keyof typeof DEFAULT_RANGES];
    if (value < range.min || value > range.max) {
      return `Out of range (${range.min}-${range.max} ${range.unit})`;
    }
    return '';
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    let val: string | number = value;
    
    if (type === 'number') {
      const parsed = parseFloat(value);
      val = isNaN(parsed) ? 0 : parsed;
    }
    
    setFormData(prev => ({ ...prev, [name]: val }));
    
    if (type === 'number') {
      const error = validate(name, val as number);
      setErrors(prev => ({ ...prev, [name]: error }));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (timestamp.getTime() > Date.now()) {
      setTimestampError('The log time cannot be in the future.');
      return;
    }
    onSave(formData, timestamp);
  };

  const handleTimestampChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextTimestamp = new Date(event.target.value);
    if (Number.isNaN(nextTimestamp.getTime())) return;
    setTimestamp(nextTimestamp);
    setTimestampError(nextTimestamp.getTime() > Date.now() ? 'The log time cannot be in the future.' : '');
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
      className="fixed inset-0 z-[60] bg-[#060e1a] overflow-y-auto"
    >
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-10">
        <header className="flex items-center justify-between border-b border-border-dim pb-6">
          <button 
            onClick={onCancel} 
            className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-ink-dim hover:text-accent transition-colors"
          >
            <ChevronLeft size={16} />
            {isHistoricEntry ? 'Back to History' : 'Back to Dashboard'}
          </button>
          <div className="text-right">
            <h1 className="text-lg font-bold text-ink tracking-tight">{isHistoricEntry ? 'Historic Reading' : 'New Reading'}</h1>
            <p className="text-[9px] font-bold uppercase tracking-widest text-ink-dim">
              {isHistoricEntry ? format(timestamp, 'd MMMM yyyy') : 'Manual Data Entry'}
            </p>
          </div>
        </header>

        <form onSubmit={handleSubmit} className="space-y-10 pb-32">
          {isHistoricEntry ? (
            <div className="card bg-[#0a1628] border-accent/30 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                    <CalendarClock size={18} />
                  </div>
                  <div>
                    <label htmlFor="reading-timestamp" className="text-[10px] font-bold uppercase tracking-widest text-white">
                      Log timestamp
                    </label>
                    <p className="mt-0.5 text-[9px] text-ink-dim">Selected from the history calendar</p>
                  </div>
                </div>
                <input
                  id="reading-timestamp"
                  type="datetime-local"
                  required
                  max={format(new Date(), "yyyy-MM-dd'T'HH:mm")}
                  value={format(timestamp, "yyyy-MM-dd'T'HH:mm")}
                  onChange={handleTimestampChange}
                  className={`input w-full bg-[#0d1f38] px-3 py-2 text-sm sm:w-auto ${timestampError ? 'border-critical' : 'border-border-dim'}`}
                />
              </div>
              {timestampError ? (
                <p className="mt-3 flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-widest text-critical">
                  <AlertCircle size={11} />
                  {timestampError}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <InputField 
              label="Free Chlorine" 
              name="chlorine" 
              value={formData.chlorine} 
              unit="ppm" 
              icon={<Droplets size={16} />}
              onChange={handleChange}
              error={errors.chlorine}
              min={0}
              max={10}
              step={0.1}
            />
            <InputField 
              label="pH Level" 
              name="ph" 
              value={formData.ph} 
              unit="" 
              icon={<Activity size={16} />}
              onChange={handleChange}
              error={errors.ph}
              min={0}
              max={14}
              step={0.1}
            />
            <InputField 
              label="Total Alkalinity" 
              name="alkalinity" 
              value={formData.alkalinity} 
              unit="ppm" 
              icon={<TrendingUp size={16} />}
              onChange={handleChange}
              error={errors.alkalinity}
              min={0}
              max={300}
              step={1}
            />
            <InputField 
              label="Temperature" 
              name="temperature" 
              value={formData.temperature} 
              unit="°C" 
              icon={<Thermometer size={16} />}
              onChange={handleChange}
              error={errors.temperature}
              min={0}
              max={50}
              step={0.5}
            />
            <InputField 
              label="Diff Pressure" 
              name="differentialPressure" 
              value={formData.differentialPressure} 
              unit="kPa" 
              icon={<Gauge size={16} />}
              onChange={handleChange}
              error={errors.differentialPressure}
              min={0}
              max={500}
              step={1}
            />
            <InputField 
              label="Calcium Hardness" 
              name="calciumHardness" 
              value={formData.calciumHardness} 
              unit="ppm" 
              icon={<Waves size={16} />}
              onChange={handleChange}
              error={errors.calciumHardness}
              min={0}
              max={1000}
              step={10}
            />
            <InputField 
              label="Cyanuric Acid" 
              name="cyanuricAcid" 
              value={formData.cyanuricAcid} 
              unit="ppm" 
              icon={<Sun size={16} />}
              onChange={handleChange}
              error={errors.cyanuricAcid}
              min={0}
              max={200}
              step={5}
            />
          </div>

          <div className="flex items-center gap-4 p-4 bg-[#0a1628] rounded-xl border border-border-dim">
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
            <div className="max-w-2xl mx-auto">
              <button 
                type="submit" 
                className="btn btn-primary w-full py-5 text-xs font-bold uppercase tracking-[0.2em] gap-3 shadow-2xl shadow-accent/20"
              >
                <Save size={18} />
                {isHistoricEntry ? 'Save Historic Log' : 'Commit to Database'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </motion.div>
  );
}

function InputField({ label, name, value, unit, icon, onChange, error, min, max, step }: any) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-[10px] font-bold uppercase tracking-widest text-ink-dim">{label}</label>
        {error ? (
          <span className="text-[9px] font-bold text-critical uppercase tracking-widest flex items-center gap-1.5">
            <AlertCircle size={10} /> {error}
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
