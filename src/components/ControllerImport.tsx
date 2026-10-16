import React, { useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileUp, Gauge, Loader2, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { collection, doc, getDocsFromServer, query, Timestamp, where, writeBatch } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { useModalFocus } from '../lib/useModalFocus';
import { useToast } from '../lib/toast';
import { HannaCsvError, HannaExport, HannaWindow, isDoseWindow, parseHannaCsv, summariseSafetyWarnings, windowDocId } from '../lib/hannaCsv';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  uid: string;
}

// A 3-month hourly export is ~2,200 rows, well under 1 MB.
const MAX_FILE_BYTES = 5 * 1024 * 1024;
// Firestore caps a batch at 500 writes.
const BATCH_SIZE = 400;
// commit() only resolves once the server acknowledges it; offline, the
// persistent cache queues the writes instead, so stop waiting after this.
const COMMIT_WAIT_MS = 20_000;

type Phase =
  | { kind: 'pick' }
  | { kind: 'reading' }
  | { kind: 'preview'; file: string; data: HannaExport; existing: Set<string> }
  | { kind: 'importing'; done: number; total: number }
  | { kind: 'done'; saved: number; queued: boolean }
  | { kind: 'error'; message: string };

const fmt = (d: Date) => d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const fmtHeaderDate = (s: string | null) => {
  const d = s ? new Date(s.replace(' ', 'T')) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : s;
};

/** Imports a Hanna BL-series controller CSV export into `controllerLogs`. */
export default function ControllerImport({ isOpen, onClose, uid }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: 'pick' });
  const inputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const busy = phase.kind === 'reading' || phase.kind === 'importing';
  const close = () => { if (!busy) { setPhase({ kind: 'pick' }); onClose(); } };
  const sheetRef = useModalFocus<HTMLDivElement>(isOpen, close);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setPhase({ kind: 'error', message: 'That file is over 5 MB, which is far bigger than a controller export. Check you picked the right file.' });
      return;
    }
    setPhase({ kind: 'reading' });
    let data: HannaExport;
    try {
      data = parseHannaCsv(await file.text());
    } catch (err) {
      setPhase({ kind: 'error', message: err instanceof HannaCsvError ? err.message : 'The file couldn\'t be read as text.' });
      return;
    }
    if (data.windows.length === 0) {
      setPhase({ kind: 'error', message: 'The export has no readings or doses in it. The controller may not have logged anything for that period.' });
      return;
    }
    // The import only writes ids this lookup didn't find, so an unknown
    // answer must stop here rather than count as "nothing imported yet".
    // From the server, not the local cache: offline, a cached getDocs
    // would quietly return a partial set.
    let existing: Set<string>;
    try {
      const snap = await getDocsFromServer(query(collection(db, 'controllerLogs'), where('uid', '==', uid), where('deviceId', '==', data.deviceId)));
      existing = new Set(snap.docs.map((d) => d.id));
    } catch (err) {
      console.error('Could not check for already-imported windows', err);
      setPhase({ kind: 'error', message: 'Couldn\'t check what\'s already been imported. Check your connection and try again.' });
      return;
    }
    setPhase({ kind: 'preview', file: file.name, data, existing });
  };

  const handleImport = async () => {
    if (phase.kind !== 'preview') return;
    const { data, existing } = phase;
    const importedAt = Timestamp.now();
    const fresh = data.windows
      .map((w) => ({ w, id: windowDocId(uid, data.deviceId, w) }))
      .filter(({ id }) => !existing.has(id));
    // Field set must match isValidControllerLog in firestore.rules exactly.
    const toDoc = (w: HannaWindow, id: string) => ({
      id, uid, source: 'hanna-csv', deviceId: data.deviceId, location: data.location,
      startLocal: w.startLocal, endLocal: w.endLocal,
      start: Timestamp.fromDate(w.start), end: Timestamp.fromDate(w.end),
      phMin: w.phMin, phMax: w.phMax, orpMinMv: w.orpMinMv, orpMaxMv: w.orpMaxMv,
      temperatureMinC: w.temperatureMinC, temperatureMaxC: w.temperatureMaxC,
      acidBaseMinMl: w.acidBaseMinMl, acidBaseMaxMl: w.acidBaseMaxMl,
      chlorineMinMl: w.chlorineMinMl, chlorineMaxMl: w.chlorineMaxMl,
      importedAt,
    });
    let saved = 0;
    setPhase({ kind: 'importing', done: 0, total: fresh.length });
    try {
      for (let i = 0; i < fresh.length; i += BATCH_SIZE) {
        const chunk = fresh.slice(i, i + BATCH_SIZE);
        const batch = writeBatch(db);
        for (const { w, id } of chunk) {
          batch.set(doc(db, 'controllerLogs', id), toDoc(w, id));
        }
        const commit = batch.commit().then(() => true);
        let timer: ReturnType<typeof setTimeout> | undefined;
        const committed = await Promise.race([
          commit,
          new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), COMMIT_WAIT_MS); }),
        ]).finally(() => clearTimeout(timer));
        saved += chunk.length;
        if (!committed) {
          commit.catch((err) => console.error('Queued controller-log batch failed', err));
          // Offline: the remaining chunks would queue the same way, so queue them too and stop waiting.
          for (let j = i + BATCH_SIZE; j < fresh.length; j += BATCH_SIZE) {
            const rest = writeBatch(db);
            for (const { w, id } of fresh.slice(j, j + BATCH_SIZE)) {
              rest.set(doc(db, 'controllerLogs', id), toDoc(w, id));
            }
            rest.commit().catch((err) => console.error('Queued controller-log batch failed', err));
          }
          setPhase({ kind: 'done', saved: fresh.length, queued: true });
          return;
        }
        setPhase({ kind: 'importing', done: saved, total: fresh.length });
      }
      setPhase({ kind: 'done', saved, queued: false });
      toast.success(`Imported ${saved} controller ${saved === 1 ? 'window' : 'windows'}`);
    } catch (err) {
      setPhase({
        kind: 'error',
        message: `Import stopped after ${saved} of ${fresh.length} windows. Importing the same file again is safe: windows already saved are skipped.`,
      });
      try { handleFirestoreError(err, OperationType.WRITE, 'controllerLogs'); } catch { /* already logged */ }
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="overlay z-[100] flex items-center justify-center p-4" onClick={close}>
          <motion.div
            ref={sheetRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="controller-import-title"
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md panel rounded-2xl overflow-hidden max-h-[90vh] flex flex-col"
          >
            <header className="panel-header p-4 flex items-center justify-between">
              <div id="controller-import-title" className="flex items-center gap-3 text-accent font-bold text-[10px] uppercase tracking-widest">
                <Gauge size={14} />
                <span>Import Controller Data</span>
              </div>
              <button onClick={close} disabled={busy} aria-label="Close" className="p-1.5 hover:bg-surface rounded-lg transition-colors text-ink-dim hover:text-white disabled:opacity-40">
                <X size={16} />
              </button>
            </header>

            <div className="p-6 space-y-4 overflow-y-auto custom-scrollbar">
              {phase.kind === 'pick' && (
                <>
                  <p className="text-sm text-ink-muted">
                    Upload the CSV exported from a Hanna BL-series controller (for example the BL122). Each hourly window keeps its
                    min and max pH, ORP and temperature, plus the acid and chlorine the controller dosed.
                  </p>
                  <button
                    type="button"
                    onClick={() => inputRef.current?.click()}
                    className="w-full rounded-xl border-2 border-dashed border-border-dim hover:border-accent/50 p-6 flex flex-col items-center gap-2 text-ink transition-colors"
                  >
                    <FileUp size={24} className="text-accent" />
                    <span className="text-sm font-bold">Choose a .csv file</span>
                    <span className="text-[10px] text-ink-dim">Nothing is saved until you confirm</span>
                  </button>
                </>
              )}

              {phase.kind === 'reading' && (
                <div className="flex items-center gap-3 text-sm text-ink-muted"><Loader2 size={16} className="animate-spin text-accent" />Reading the export…</div>
              )}

              {phase.kind === 'preview' && <Preview phase={phase} uid={uid} />}

              {phase.kind === 'importing' && (
                <div className="space-y-2" role="status">
                  <div className="flex items-center gap-3 text-sm text-ink"><Loader2 size={16} className="animate-spin text-accent" />Saving {phase.done} of {phase.total}…</div>
                  <div className="h-1.5 rounded-full bg-surface overflow-hidden">
                    <div className="h-full bg-accent transition-all" style={{ width: `${phase.total ? (phase.done / phase.total) * 100 : 100}%` }} />
                  </div>
                </div>
              )}

              {phase.kind === 'done' && (
                <div className="flex gap-3 items-start" role="status">
                  <CheckCircle2 size={20} className="text-success shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="text-sm font-bold text-ink">{phase.saved === 0 ? 'Nothing new to import' : `${phase.saved} ${phase.saved === 1 ? 'window' : 'windows'} ${phase.queued ? 'queued' : 'imported'}`}</p>
                    <p className="text-xs text-ink-muted">
                      {phase.queued
                        ? 'You seem to be offline. The windows are saved on this device and will upload when you\'re back online.'
                        : 'Saved to the controller log. Your readings history is unchanged.'}
                    </p>
                  </div>
                </div>
              )}

              {phase.kind === 'error' && (
                <div className="flex gap-3 items-start" role="alert">
                  <AlertTriangle size={20} className="text-warning shrink-0 mt-0.5" />
                  <p className="text-sm text-ink">{phase.message}</p>
                </div>
              )}

              <input ref={inputRef} type="file" accept=".csv,text/csv" onChange={handleFile} className="hidden" tabIndex={-1} aria-hidden="true" />
            </div>

            <footer className="panel-footer p-4 flex gap-2">
              {phase.kind === 'preview' ? (
                <>
                  <button onClick={() => setPhase({ kind: 'pick' })} className="flex-1 py-3 rounded-xl border border-border-dim text-ink-muted text-[10px] font-bold uppercase tracking-widest hover:text-white">
                    Back
                  </button>
                  {(() => {
                    const fresh = phase.data.windows.filter((w) => !phase.existing.has(windowDocId(uid, phase.data.deviceId, w))).length;
                    return (
                      <button
                        onClick={handleImport}
                        disabled={fresh === 0}
                        className="flex-[2] py-3 rounded-xl bg-accent text-primary text-[10px] font-bold uppercase tracking-widest hover:brightness-110 transition-all disabled:opacity-50"
                      >
                        {fresh === 0 ? 'Already imported' : `Import ${fresh} ${fresh === 1 ? 'window' : 'windows'}`}
                      </button>
                    );
                  })()}
                </>
              ) : phase.kind === 'error' ? (
                <button onClick={() => setPhase({ kind: 'pick' })} className="w-full py-3 rounded-xl bg-accent text-primary text-[10px] font-bold uppercase tracking-widest hover:brightness-110 transition-all">
                  Try another file
                </button>
              ) : (
                <button onClick={close} disabled={busy} className="w-full py-3 rounded-xl border border-border-dim text-ink-muted text-[10px] font-bold uppercase tracking-widest hover:text-white disabled:opacity-40">
                  {phase.kind === 'done' ? 'Done' : 'Cancel'}
                </button>
              )}
            </footer>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

function Preview({ phase, uid }: { phase: Extract<Phase, { kind: 'preview' }>; uid: string }) {
  const { data, existing, file } = phase;
  const first = data.windows[0].start;
  const last = data.windows[data.windows.length - 1].end;
  const already = data.windows.filter((w) => existing.has(windowDocId(uid, data.deviceId, w))).length;
  const hours = (last.getTime() - first.getTime()) / 3_600_000;
  const requested = data.requestedStart && data.requestedEnd
    ? (new Date(data.requestedEnd.replace(' ', 'T')).getTime() - new Date(data.requestedStart.replace(' ', 'T')).getTime()) / 3_600_000
    : NaN;
  // Flag when the file holds far less than the header's period (e.g. 44 h of a 3-month export).
  const safety = summariseSafetyWarnings(data.windows);
  const serious = safety.worst.some((x) => x.level === 'warning');
  const shortfall = Number.isFinite(requested) && requested > 0 && hours < requested * 0.5;

  const rows: [string, string][] = [
    ['File', file],
    ['Controller', [data.deviceId, data.location].filter(Boolean).join(' · ')],
    ['Covers', `${fmt(first)} → ${fmt(last)}`],
    ['Windows found', String(data.windows.length)],
    ['Dose events', String(data.windows.filter(isDoseWindow).length)],
    ['Already imported', String(already)],
  ];
  if (data.emptyRows) rows.push(['Empty rows skipped', String(data.emptyRows)]);
  if (data.invalidRows.length) rows.push(['Unreadable rows skipped', `#${data.invalidRows.join(', #')}`]);

  return (
    <div className="space-y-3">
      <dl className="rounded-xl bg-surface border border-border-dim divide-y divide-border-dim">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 px-4 py-2.5 text-xs">
            <dt className="text-ink-muted">{k}</dt>
            <dd className="font-mono text-ink text-right break-all">{v}</dd>
          </div>
        ))}
      </dl>
      {safety.worst.length > 0 && (
        <div className={`rounded-xl border p-3 space-y-2 text-xs text-ink ${serious ? 'border-critical/50 bg-critical/5' : 'border-warning/40 bg-warning/5'}`} role="alert">
          <div className="flex gap-2 items-start font-bold">
            <AlertTriangle size={14} className={`${serious ? 'text-critical' : 'text-warning'} shrink-0 mt-0.5`} />
            <span>{safety.affectedWindows} of {data.windows.length} windows have pH or ORP {serious ? 'outside the safe range' : 'above the target range'}</span>
          </div>
          <ul className="space-y-1.5 pl-6">
            {safety.worst.map((x) => (
              <li key={`${x.field}:${x.end}`}>
                <span className="font-mono">
                  {x.end === 'min' ? 'Lowest' : 'Highest'} {x.field === 'ph' ? 'pH' : 'ORP'} {x.field === 'ph' ? x.value.toFixed(2) : `${x.value} mV`}
                </span>
                <span className="text-ink-muted"> · {fmt(x.window.start)}. {x.message}</span>
              </li>
            ))}
          </ul>
          <p className="text-ink-muted">Importing still saves every value as recorded. If these are recent, retest by hand before dosing, and follow the product label and your pool contractor's guidance.</p>
        </div>
      )}
      {shortfall && (
        <div className="flex gap-2 items-start rounded-xl border border-warning/40 bg-warning/5 p-3 text-xs text-ink">
          <AlertTriangle size={14} className="text-warning shrink-0 mt-0.5" />
          <span>
            The export was requested for {fmtHeaderDate(data.requestedStart)} – {fmtHeaderDate(data.requestedEnd)}, but it only
            holds about {Math.round(hours)} hours of data.
          </span>
        </div>
      )}
      <p className="text-[10px] text-ink-dim">Times are read as this device's local time. These windows go to a separate controller log and don't appear in Readings.</p>
    </div>
  );
}
