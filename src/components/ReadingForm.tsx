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
import { Reading, DEFAULT_RANGES } from '../types';
import { generateContentWithRetry } from '../lib/gemini';

interface Props {
  onSave: (reading: Omit<Reading, 'id' | 'timestamp'>) => void;
  onCancel: () => void;
}

const NUMERIC_FIELDS = ['chlorine', 'ph', 'alkalinity', 'temperature', 'differentialPressure', 'calciumHardness', 'cyanuricAcid'] as const;
type NumericField = typeof NUMERIC_FIELDS[number];

type FormData = Record<NumericField, number | null> & {
  notes: string;
  uid: string;
};

const INITIAL_FORM: FormData = {
  chlorine: null,
  ph: null,
  alkalinity: null,
  temperature: null,
  differentialPressure: null,
  calciumHardness: null,
  cyanuricAcid: null,
  notes: '',
  uid: '',
};

const INITIAL_RAW: Record<NumericField, string> = {
  chlorine: '',
  ph: '',
  alkalinity: '',
  temperature: '',
  differentialPressure: '',
  calciumHardness: '',
  cyanuricAcid: '',
};

export default function ReadingForm({ onSave, onCancel }: Props) {
  const [formData, setFormData] = useState<FormData>(INITIAL_FORM);
  const [rawInputs, setRawInputs] = useState<Record<NumericField, string>>(INITIAL_RAW);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isTranscribingNotes, setIsTranscribingNotes] = useState(false);
  const [isAnalyzingImage, setIsAnalyzingImage] = useState(false);

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
      const fieldName = name as NumericField;
      setRawInputs(prev => ({ ...prev, [fieldName]: value }));
      if (value === '' || value.endsWith('.')) {
        setFormData(prev => ({ ...prev, [fieldName]: value === '' ? null : prev[fieldName] }));
        setErrors(prev => ({ ...prev, [fieldName]: '' }));
      } else {
        const parsed = parseFloat(value);
        if (!isNaN(parsed)) {
          setFormData(prev => ({ ...prev, [fieldName]: parsed }));
          setErrors(prev => ({ ...prev, [fieldName]: validate(fieldName, parsed) }));
        }
      }
    } else {
      setFormData(prev => ({ ...prev, [name]: value }));
    }
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    const fieldName = name as NumericField;
    if (value === '') {
      setFormData(prev => ({ ...prev, [fieldName]: null }));
      setErrors(prev => ({ ...prev, [fieldName]: '' }));
      return;
    }
    const parsed = parseFloat(value);
    if (isNaN(parsed)) {
      setRawInputs(prev => ({ ...prev, [fieldName]: '' }));
      setFormData(prev => ({ ...prev, [fieldName]: null }));
      setErrors(prev => ({ ...prev, [fieldName]: '' }));
      return;
    }
    setRawInputs(prev => ({ ...prev, [fieldName]: String(parsed) }));
    setFormData(prev => ({ ...prev, [fieldName]: parsed }));
    setErrors(prev => ({ ...prev, [fieldName]: validate(fieldName, parsed) }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Flush any rawInputs that are still mid-edit (e.g. focused field ending with ".").
    // Empty strings remain null — "not measured" is a valid state.
    const flushed: FormData = { ...formData };
    for (const field of NUMERIC_FIELDS) {
      const raw = rawInputs[field] ?? '';
      if (raw === '') {
        flushed[field] = null;
      } else {
        const parsed = parseFloat(raw);
        if (!isNaN(parsed)) flushed[field] = parsed;
      }
    }
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
              const validFields: Partial<Record<NumericField, number>> = {};
              for (const field of NUMERIC_FIELDS) {
                const parsed = parseFloat(String(result[field]));
                if (!isNaN(parsed) && isFinite(parsed)) validFields[field] = parsed;
              }
              setFormData(prev => ({ ...prev, ...validFields, notes: result.notes || prev.notes }));
              setRawInputs(prev => ({
                ...prev,
                ...Object.fromEntries(Object.entries(validFields).map(([k, v]) => [k, String(v)])),
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

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsAnalyzingImage(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const base64 = dataUrl.split(',')[1];
      const response = await generateContentWithRetry({
        model: "gemini-3-flash-preview",
        contents: [
          {
            inlineData: {
              mimeType: file.type || 'image/jpeg',
              data: base64
            }
          },
          {
            text: `Extract pool report details from this image. Return ONLY a JSON object with keys:
chlorine, ph, alkalinity, temperature, differentialPressure, calciumHardness, cyanuricAcid, notes, missingInventory, missingEquipment.
missingInventory and missingEquipment should be arrays of strings when identifiable.`
          }
        ],
        config: { responseMimeType: "application/json" }
      }, process.env.GEMINI_API_KEY!);
      const parsed = JSON.parse(response.text || '{}');
      const validFields: Partial<Record<NumericField, number>> = {};
      for (const field of NUMERIC_FIELDS) {
        const v = parseFloat(String(parsed[field]));
        if (!isNaN(v) && isFinite(v)) validFields[field] = v;
      }
      const noteParts = [
        parsed.notes,
        parsed.missingInventory?.length ? `Missing Inventory: ${parsed.missingInventory.join(', ')}` : '',
        parsed.missingEquipment?.length ? `Missing Equipment: ${parsed.missingEquipment.join(', ')}` : ''
      ].filter(Boolean);
      setFormData(prev => ({
        ...prev,
        ...validFields,
        notes: noteParts.length ? `${prev.notes ? `${prev.notes}\n` : ''}${noteParts.join('\n')}` : prev.notes
      }));
      setRawInputs(prev => ({
        ...prev,
        ...Object.fromEntries(Object.entries(validFields).map(([k, v]) => [k, String(v)])),
      }));
    } catch (error) {
      console.error('Image analysis failed', error);
    } finally {
      setIsAnalyzingImage(false);
      e.target.value = '';
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

        <form onSubmit={handleSubmit} noValidate className="space-y-10 pb-32">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <InputField label="Free Chlorine" name="chlorine" value={rawInputs.chlorine} unit="ppm" icon={<Droplets size={16} />} onChange={handleChange} onBlur={handleBlur} error={errors.chlorine} min={0} max={10} step="any" isEmpty={formData.chlorine == null} />
            <InputField label="pH Level" name="ph" value={rawInputs.ph} unit="" icon={<Activity size={16} />} onChange={handleChange} onBlur={handleBlur} error={errors.ph} min={0} max={14} step="any" isEmpty={formData.ph == null} />
            <InputField label="Total Alkalinity" name="alkalinity" value={rawInputs.alkalinity} unit="ppm" icon={<TrendingUp size={16} />} onChange={handleChange} onBlur={handleBlur} error={errors.alkalinity} min={0} max={300} step="any" isEmpty={formData.alkalinity == null} />
            <InputField label="Temperature" name="temperature" value={rawInputs.temperature} unit="°C" icon={<Thermometer size={16} />} onChange={handleChange} onBlur={handleBlur} error={errors.temperature} min={0} max={50} step="any" isEmpty={formData.temperature == null} />
            <InputField label="Diff Pressure" name="differentialPressure" value={rawInputs.differentialPressure} unit="kPa" icon={<Gauge size={16} />} onChange={handleChange} onBlur={handleBlur} error={errors.differentialPressure} min={0} max={500} step="any" isEmpty={formData.differentialPressure == null} />
            <InputField label="Calcium Hardness" name="calciumHardness" value={rawInputs.calciumHardness} unit="ppm" icon={<Waves size={16} />} onChange={handleChange} onBlur={handleBlur} error={errors.calciumHardness} min={0} max={1000} step="any" isEmpty={formData.calciumHardness == null} />
            <InputField label="Cyanuric Acid" name="cyanuricAcid" value={rawInputs.cyanuricAcid} unit="ppm" icon={<Sun size={16} />} onChange={handleChange} onBlur={handleBlur} error={errors.cyanuricAcid} min={0} max={200} step="any" isEmpty={formData.cyanuricAcid == null} />
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
          <div className="flex items-center justify-between p-4 bg-bg/40 rounded-xl border border-border-dim">
            <p className="text-[9px] text-ink-dim italic">Upload a photo of a report sheet/equipment room and auto-extract values.</p>
            <label className={`px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest cursor-pointer transition-all ${isAnalyzingImage ? 'bg-critical text-white' : 'bg-accent/10 text-accent hover:bg-accent/20'}`}>
              {isAnalyzingImage ? 'Analyzing…' : 'Upload Image'}
              <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" disabled={isAnalyzingImage} />
            </label>
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
                Commit to Database
              </button>
            </div>
          </div>
        </form>
      </div>
    </motion.div>
  );
}

function InputField({ label, name, value, unit, icon, onChange, onBlur, error, min, max, step, isEmpty }: any) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-[10px] font-bold uppercase tracking-widest text-ink-dim">{label}</label>
        {error ? (
          <span className="text-[9px] font-bold text-critical uppercase tracking-widest flex items-center gap-1.5">
            <AlertCircle size={10} /> {error}
          </span>
        ) : isEmpty ? (
          <span className="text-[9px] font-bold text-ink-dim uppercase tracking-widest flex items-center gap-1.5">
            <MinusCircle size={10} /> Not measured
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
          placeholder="—"
          className={`input bg-[#0d1f38] pl-12 pr-16 py-4 text-sm font-mono ${error ? 'border-critical focus:ring-critical/10' : 'border-border-dim focus:border-accent focus:ring-accent/10'}`}
        />
        <div className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-bold text-ink-dim uppercase tracking-widest">
          {unit}
        </div>
      </div>
    </div>
  );
}
