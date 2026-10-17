import React from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Bell,
  CheckCircle2,
  ChevronRight,
  FileText,
  LineChart as LineChartIcon,
  ListChecks,
  Loader2,
  Package,
  Play,
  Plus,
  Plug,
  RotateCw,
  Sparkles,
  Wrench,
  X,
} from 'lucide-react';
import { motion } from 'motion/react';
import { Reading, MaintenanceTask, DEFAULT_RANGES, Status, MaintenanceSchedule, InventoryItem, EquipmentItem, POOL_PROFILE } from '../types';
import { calculateLSI, getLsiStatus } from '../lib/lsi';
import { getLatestReadingForDisplay, getMostRecentOrp, formatAge, isOrpStale, classifyOrp, isAutoSyncBoilerplateNote } from '../lib/readings';
import { NumericReadingField, combinedChlorineOf, getCombinedChlorineStatus, COMBINED_CHLORINE_MAX, COMBINED_CHLORINE_OK_MAX, ORP_ACTION_ALERT_MV } from '../lib/readingValidation';
import {
  describePhDrift,
  describeSync,
  getLsiStateWord,
  getRangeStatus,
  getTrendGlyph,
  lsiMarkerPercent,
  summarizeAgentActivity,
  summarizeEquipment,
  summarizeInventory,
  summarizeWeek,
  TileBadge,
} from '../lib/dashboardSummary';
import { AiProtocol, ProtocolState, PROTOCOL_ERROR_MESSAGE, protocolHeadline } from '../lib/aiProtocol';
import { TrendMetricKey } from '../lib/trends';
import { useLongPress } from '../lib/useLongPress';
import { useToast } from '../lib/toast';

export type AssistantOpenMode = 'menu' | 'protocol';

interface Props {
  readings: Reading[];
  /** False until the first Firestore snapshot lands — drives the skeleton state. */
  readingsLoaded: boolean;
  tasks: MaintenanceTask[];
  schedule: MaintenanceSchedule;
  inventory: InventoryItem[];
  equipment: EquipmentItem[];
  protocol: AiProtocol | null;
  protocolState: ProtocolState;
  onRequestProtocol: () => void;
  onExecuteProtocol: () => void;
  onLogReading: (focusField?: NumericReadingField) => void;
  onViewHistory: () => void;
  onOpenTrends: (metric?: TrendMetricKey) => void;
  onOpenTasks: () => void;
  onOpenEquipment: () => void;
  onOpenInventory: () => void;
  onOpenWeeklyReport: () => void;
  onOpenReminderSettings: () => void;
  onOpenAssistant: (mode: AssistantOpenMode) => void;
  onSyncPoolController: () => Promise<{ written: boolean; outcome?: string }>;
  onProbePoolController: () => Promise<{
    written: false;
    outcome: string;
    reading: { ph: number | null; sanitisationMv: number | null; temperature: number | null; recordedAt: string } | null;
  }>;
}

// Status tints from the design tokens: text at the -400 Tailwind stop,
// background at 6–8 % and border at 35–45 % of the base colour.
const STATUS_UI: Record<Status, { text: string; bg: string; border: string; chip: string; hex: string }> = {
  good: { text: 'text-success-text', bg: 'bg-success/6', border: 'border-success/35', chip: '✓ OK', hex: '#34D399' },
  warning: { text: 'text-warning-text', bg: 'bg-warning/7', border: 'border-warning/40', chip: '⚠ Watch', hex: '#FBBF24' },
  critical: { text: 'text-critical-text', bg: 'bg-critical/8', border: 'border-critical/45', chip: '✕ Action', hex: '#F87171' },
};
const NEUTRAL_UI = { text: 'text-ink-muted', bg: 'bg-surface-2', border: 'border-border-dim', chip: '—', hex: '#8AB4CC' };

const LABEL = 'text-[10px] font-bold uppercase tracking-[0.16em] text-ink-dim';
const CARD_SHADOW = 'shadow-[0_10px_20px_rgba(0,0,0,0.4)]';

const sectionMotion = (index: number) => ({
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { delay: index * 0.04 },
});

export default function Dashboard({
  readings, readingsLoaded, tasks, schedule, inventory, equipment,
  protocol, protocolState, onRequestProtocol, onExecuteProtocol,
  onLogReading, onViewHistory, onOpenTrends, onOpenTasks, onOpenEquipment, onOpenInventory, onOpenWeeklyReport,
  onOpenReminderSettings, onOpenAssistant, onSyncPoolController, onProbePoolController,
}: Props) {
  const [dismissedAlerts, setDismissedAlerts] = React.useState<string[]>([]);
  // ORP staleness and the sync pill's age are judged against wall-clock
  // "now", but this component otherwise only re-renders when props/state
  // change -- if auto-sync polling stops entirely, no new Firestore snapshot
  // ever arrives, so nothing would trigger a re-render and the "LIVE · 2
  // MIN" pill would stay frozen forever. Tick once a minute so a reading
  // that crosses the staleness threshold while the page sits open is caught.
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  // The sync pill doubles as the manual "sync now" button for the Hanna
  // Cloud pool controller telemetry job (see CLAUDE.md's "Pool controller
  // telemetry" section). syncLight reflects the outcome briefly, then
  // fades back to idle so it never looks like a permanent status.
  const [syncLight, setSyncLight] = React.useState<'idle' | 'syncing' | 'success' | 'neutral' | 'error'>('idle');
  const toast = useToast();
  const [probePending, setProbePending] = React.useState(false);
  const [probeResult, setProbeResult] = React.useState<{
    outcome: string;
    reading: { ph: number | null; sanitisationMv: number | null; temperature: number | null; recordedAt: string } | null;
  } | null>(null);
  const handleProbeClick = async () => {
    if (probePending) return;
    setProbePending(true);
    setProbeResult(null);
    try {
      const result = await onProbePoolController();
      setProbeResult(result);
      if (!result.reading) toast.info('Connected, but no usable controller measurements are available');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Hanna Cloud connection test failed');
    } finally {
      setProbePending(false);
    }
  };
  const syncResetTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => () => {
    if (syncResetTimer.current) clearTimeout(syncResetTimer.current);
  }, []);
  const handleSyncClick = async () => {
    if (syncLight === 'syncing') return;
    if (syncResetTimer.current) {
      clearTimeout(syncResetTimer.current);
      syncResetTimer.current = null;
    }
    setSyncLight('syncing');
    try {
      const result = await onSyncPoolController();
      setSyncLight(result.written ? 'success' : 'neutral');
    } catch (e) {
      console.error('Manual pool controller sync failed:', e);
      setSyncLight('error');
      // The pill alone fades after a few seconds — toast's error variant is
      // role="alert" so a screen reader (or a glance away) doesn't miss it.
      toast.error(e instanceof Error ? e.message : 'Pool controller sync failed');
    } finally {
      syncResetTimer.current = setTimeout(() => {
        setSyncLight('idle');
        syncResetTimer.current = null;
      }, 3000);
    }
  };

  // Backfills alkalinity/calciumHardness (LSI's slow-changing inputs) from
  // history when the latest reading is a controller-only poll — see
  // getLatestReadingForDisplay's docstring for why only those two fields.
  const latest = getLatestReadingForDisplay(readings);

  // ORP alone: a real controller response can report pH/temperature but
  // omit ORP for one poll. Bounded (see getMostRecentOrp) and always
  // labeled with its own age — never presented as this instant's reading.
  const recentOrp = getMostRecentOrp(readings);
  const orpIsStale = recentOrp != null && isOrpStale(recentOrp.at, now);

  const lsiScore: number | null = latest ? calculateLSI(latest) : null;
  const lsiStatus: Status | null = lsiScore == null ? null : getLsiStatus(lsiScore);

  // Protocol auto-run keyed on every value requestAiProtocol sends to the
  // model, not latest.id: each 15-min auto-sync poll creates a new reading
  // document, so keying on id would re-trigger this paid AI call on every
  // poll even when nothing it reads has changed. A genuine change to any
  // prompt input (chlorine, ORP, CYA, pressure, or a new maintenance note)
  // must re-run it, or the checklist on screen goes stale. The assistant
  // sheet's "Analyze readings" re-runs it on demand.
  // Same note selection as requestAiProtocol: the five most recent manual notes.
  const promptNotes = readings
    .filter((r) => r.notes && !isAutoSyncBoilerplateNote(r.notes))
    .slice(0, 5)
    .map((r) => `${r.id}:${r.notes}`);
  const protocolInputsKey = latest
    ? JSON.stringify([
        latest.ph, latest.temperature, latest.calciumHardness, latest.alkalinity,
        latest.chlorine, latest.totalChlorine, latest.cyanuricAcid, latest.differentialPressure,
        recentOrp?.value ?? null, orpIsStale,
        promptNotes,
        inventory.map((item) => [item.name, item.concentrationPct ?? null]),
      ])
    : null;
  React.useEffect(() => {
    if (latest) onRequestProtocol();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [protocolInputsKey]);

  const combinedChlorine = latest ? combinedChlorineOf(latest.chlorine, latest.totalChlorine) : null;
  // Combined chlorine has no card on this screen, so every non-good level
  // must reach the operator here, keeping its own severity.
  const combinedStatus: Status = combinedChlorine == null ? 'good' : getCombinedChlorineStatus(combinedChlorine);

  // Every alert's own live condition, unfiltered by dismissal — feeds both
  // allAlerts (for rendering) and the effect below that decides which
  // dismissals are still valid.
  const rawAlerts: { id: string; condition: boolean; msg: string; action: string; severity: 'critical' | 'warning' }[] = latest ? [
    {
      id: 'cl_low',
      condition: latest.chlorine != null && latest.chlorine < DEFAULT_RANGES.chlorine.min,
      msg: 'Free chlorine critically low — pool unsafe. Dose now.',
      action: 'Add chlorine or shock treatment immediately.',
      severity: 'critical',
    },
    {
      id: 'cl_high',
      condition: latest.chlorine != null && latest.chlorine > DEFAULT_RANGES.chlorine.max,
      msg: 'Chlorine elevated — likely post-shock.',
      action: 'Stop chlorination and wait for levels to drop.',
      severity: 'warning',
    },
    // Combined chlorine (chloramines) isn't one of the four telemetry cards
    // on this screen, so the one place it can still reach the operator is
    // here. Thresholds follow readingValidation's getCombinedChlorineStatus.
    {
      id: 'cc_high',
      condition: combinedStatus !== 'good',
      msg: combinedStatus === 'critical'
        ? `Combined chlorine ${combinedChlorine?.toFixed(1)} ppm (>${COMBINED_CHLORINE_MAX}) — chloramines high.`
        : `Combined chlorine ${combinedChlorine?.toFixed(1)} ppm — ideal is under ${COMBINED_CHLORINE_OK_MAX}.`,
      action: combinedStatus === 'critical'
        ? 'Shock to breakpoint and retest before swimming.'
        : 'Retest free and total chlorine; shock if combined chlorine keeps rising.',
      severity: combinedStatus === 'critical' ? 'critical' : 'warning',
    },
    // sanitisationMv (ORP) is the only sanitiser signal a pool-controller
    // sync ever reports, so without this alert a dangerously low ORP from an
    // auto-synced reading would show zero alerts. Thresholds and the "verify
    // before dosing" action text follow AGENTS.md: ORP indicates sanitising
    // effectiveness, not a chlorine ppm value, so an ORP-only alert must send
    // the operator to actually test chlorine rather than dose blind.
    // orp_high keys off ORP_ACTION_ALERT_MV (800 mV, AGENTS.md's own literal
    // "verify before swimming" line), not classifyOrp's 850 mV ceiling.
    {
      id: 'orp_low',
      condition: recentOrp != null && recentOrp.value < DEFAULT_RANGES.sanitisationMv.min,
      msg: `Sanitisation (ORP) too low — disinfection may be inadequate.${orpIsStale ? ` (last measured ${formatAge(recentOrp!.at, now)})` : ''}`,
      action: 'Test free chlorine and confirm circulation/filtration is running before dosing — ORP is not a ppm reading.',
      severity: 'critical',
    },
    {
      id: 'orp_high',
      condition: recentOrp != null && recentOrp.value > ORP_ACTION_ALERT_MV,
      msg: `Sanitisation (ORP) high — verify before swimming or adding more chlorine.${orpIsStale ? ` (last measured ${formatAge(recentOrp!.at, now)})` : ''}`,
      action: 'Retest and confirm dosing hasn\'t over-shot before any further additions.',
      severity: 'warning',
    },
    {
      id: 'ph_low',
      condition: latest.ph != null && latest.ph < DEFAULT_RANGES.ph.min,
      msg: 'pH too low — corrosive water.',
      action: 'Add sodium carbonate (Soda Ash).',
      severity: 'critical',
    },
    {
      id: 'ph_high',
      condition: latest.ph != null && latest.ph > DEFAULT_RANGES.ph.max,
      msg: 'pH too high — chlorine less effective.',
      action: 'Add muriatic acid.',
      severity: 'warning',
    },
    {
      id: 'alk_low',
      condition: latest.alkalinity != null && latest.alkalinity < DEFAULT_RANGES.alkalinity.min,
      msg: 'Low alkalinity — pH will be unstable.',
      action: 'Add sodium bicarbonate.',
      severity: 'warning',
    },
    {
      id: 'alk_high',
      condition: latest.alkalinity != null && latest.alkalinity > DEFAULT_RANGES.alkalinity.max,
      msg: 'Alkalinity is too high.',
      action: 'Add pH decreaser or partially drain.',
      severity: 'warning',
    },
    {
      id: 'dp_high',
      condition: latest.differentialPressure != null && latest.differentialPressure > DEFAULT_RANGES.differentialPressure.max,
      msg: 'Filter pressure elevated — flow restricted.',
      action: 'Backwash filter or clean cartridges immediately.',
      severity: 'critical',
    },
    // The pressure card was removed from this screen, so a low reading (air
    // leak, blocked skimmer, or pump cavitation, per the assistant's pool
    // guidance) needs its own alert. Below the minimum is critical, matching
    // the old card's out-of-range status.
    {
      id: 'temp_out',
      condition: latest.temperature != null && (latest.temperature < DEFAULT_RANGES.temperature.min || latest.temperature > DEFAULT_RANGES.temperature.max),
      msg: `Water temperature ${latest.temperature}°C is outside the ${DEFAULT_RANGES.temperature.min}–${DEFAULT_RANGES.temperature.max}°C working range.`,
      action: 'Test chlorine and pH more often while the water is outside this range.',
      severity: 'warning',
    },
    {
      id: 'dp_low',
      condition: latest.differentialPressure != null && latest.differentialPressure < DEFAULT_RANGES.differentialPressure.min,
      msg: 'Filter pressure low — check for an air leak, blocked skimmer, or pump cavitation.',
      action: 'Check the skimmer basket, pump suction and fittings for air before anything else. Low pressure is not normal.',
      severity: 'critical',
    },
    {
      // Folding nextTestDate into the id gives each due-date its own
      // dismissal identity, so a schedule change re-surfaces the warning
      // even when "overdue" never toggled off in between.
      id: schedule.nextTestDate ? `test_due:${new Date(schedule.nextTestDate).getTime()}` : 'test_due',
      condition: schedule.nextTestDate ? now >= new Date(schedule.nextTestDate) : false,
      msg: 'Water test due — maintenance schedule.',
      action: 'Log a new reading to maintain water balance.',
      severity: 'warning',
    },
  ] : [];

  const allAlerts = rawAlerts.filter((a) => a.condition && !dismissedAlerts.includes(a.id));

  // Auto-clear a dismissal once its own alert's condition resolves, so a
  // dismissal survives unrelated changes and same-band jitter but re-arms
  // once the alert has genuinely gone away and can recur.
  const activeAlertIdsKey = rawAlerts.filter((a) => a.condition).map((a) => a.id).join('|');
  React.useEffect(() => {
    const activeIds = new Set(activeAlertIdsKey ? activeAlertIdsKey.split('|') : []);
    setDismissedAlerts((prev) => {
      const next = prev.filter((id) => activeIds.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [activeAlertIdsKey]);

  const isTestDue = schedule.nextTestDate ? now >= new Date(schedule.nextTestDate) : false;
  const hasUnread = isTestDue || allAlerts.length > 0;

  const sync = describeSync(readings[0], now);

  const tasksDone = tasks.filter((t) => t.completed).length;
  const tasksTotal = tasks.length;

  const equipmentTile = summarizeEquipment(equipment, now);
  const inventoryTile = summarizeInventory(inventory);
  const weekTile = summarizeWeek(readings, now);
  const agents = summarizeAgentActivity(readings, now);

  const metricStatus = (value: number | null | undefined, range: { min: number; max: number }): Status | null =>
    value == null ? null : getRangeStatus(value, range.min, range.max);

  let section = 0;

  return (
    <div className="min-h-screen">
      {/* ── Top chrome ─────────────────────────────────────────────────── */}
      <header
        className="sticky top-0 z-30 bg-bg/85 backdrop-blur-[12px] border-b border-border-dim no-print"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="max-w-4xl mx-auto px-5 py-3 flex items-center justify-between gap-3">
          <div className="flex flex-col gap-1 min-w-0">
            <h1 className="text-lg font-extrabold uppercase tracking-[0.14em] leading-none whitespace-nowrap text-white">
              Pool<span className="text-accent">Status</span>
            </h1>
            <p className="font-mono text-[10px] tracking-[0.12em] uppercase text-ink-dim whitespace-nowrap">
              {POOL_PROFILE.name} · {POOL_PROFILE.volumeLitres.toLocaleString()} L
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleSyncClick}
              disabled={syncLight === 'syncing'}
              aria-label="Telemetry sync status. Tap to sync the latest reading from the pool controller now."
              title="Sync latest reading from the pool controller now"
              className="h-9 px-2.5 rounded-full bg-surface border border-border-dim flex items-center gap-[7px] active:scale-95 transition-transform disabled:cursor-wait"
            >
              <SyncDot kind={syncLight === 'syncing' ? 'syncing' : syncLight === 'error' ? 'error' : sync.kind} />
              <span className={`font-mono text-[10px] tracking-[0.1em] uppercase whitespace-nowrap ${sync.kind === 'stale' && syncLight === 'idle' ? 'text-warning-text' : 'text-ink-muted'}`}>
                {syncLight === 'syncing' ? 'SYNCING…' : syncLight === 'success' ? 'SYNCED' : syncLight === 'error' ? 'SYNC FAILED' : sync.label}
              </span>
            </button>
            <button
              type="button"
              onClick={onOpenReminderSettings}
              aria-label={hasUnread ? 'Reminders — attention needed' : 'Reminders'}
              title="Reminders"
              className="relative w-11 h-11 rounded-xl bg-surface border border-border-dim flex items-center justify-center text-ink-muted active:scale-95 transition-transform"
            >
              <Bell size={20} />
              {hasUnread && <span aria-hidden="true" className="absolute top-[10px] right-[11px] w-[7px] h-[7px] rounded-full bg-warning ring-2 ring-surface" />}
            </button>
          </div>
        </div>
      </header>

      <div
        className="max-w-4xl mx-auto px-5 pt-5 flex flex-col gap-5"
        style={{ paddingBottom: 'calc(140px + env(safe-area-inset-bottom))' }}
      >
        {!readingsLoaded ? (
          <DashboardSkeleton />
        ) : (
          <>
            {/* ── Alerts ──────────────────────────────────────────────── */}
            {allAlerts.length > 0 && (
              <motion.section {...sectionMotion(section++)} className="flex flex-col gap-3 no-print" aria-label="Alerts">
                {allAlerts.map((alert) => {
                  const ui = STATUS_UI[alert.severity];
                  const Icon = alert.severity === 'critical' ? AlertCircle : AlertTriangle;
                  return (
                    <div key={alert.id} role="alert" className={`flex gap-3 items-start px-4 py-3.5 rounded-xl border ${ui.bg} ${ui.border}`}>
                      <Icon size={20} className={`shrink-0 mt-px ${ui.text}`} aria-hidden="true" />
                      <div className="flex flex-col gap-1 flex-1 min-w-0">
                        <p className="text-sm font-semibold leading-[1.35] text-white [text-wrap:pretty]">{alert.msg}</p>
                        <p className={`font-mono text-[10px] tracking-[0.08em] uppercase leading-normal ${ui.text}`}>ACTION: {alert.action}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setDismissedAlerts((prev) => [...prev, alert.id])}
                        aria-label="Dismiss alert"
                        className="shrink-0 -m-2 p-2 text-ink-dim hover:text-white transition-colors"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  );
                })}
              </motion.section>
            )}

            <div className="flex flex-col gap-5 md:grid md:grid-cols-2 md:items-stretch">
              {/* ── LSI hero ──────────────────────────────────────────── */}
              <motion.section {...sectionMotion(section++)} aria-label="Water balance" className={`rounded-2xl bg-surface border p-[18px] pb-4 flex flex-col gap-3.5 md:col-start-1 md:row-start-1 ${CARD_SHADOW} ${lsiStatus ? STATUS_UI[lsiStatus].border : 'border-border-dim'}`}>
                <div className="flex justify-between items-center">
                  <p className={`${LABEL} whitespace-nowrap`}>Water Balance · LSI</p>
                  <StatusChip status={lsiStatus} />
                </div>
                <div className="flex items-end justify-between gap-3">
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <p className={`font-mono text-5xl font-bold leading-none tracking-[-0.02em] tabular-nums ${lsiStatus ? STATUS_UI[lsiStatus].text : 'text-ink-dim'}`}>
                      {lsiScore == null ? '—' : `${lsiScore > 0 ? '+' : lsiScore < 0 ? '−' : ''}${Math.abs(lsiScore).toFixed(2)}`}
                    </p>
                    <p className="text-base font-extrabold uppercase tracking-[0.16em] text-white mt-2">
                      {lsiScore == null ? 'Insufficient data' : getLsiStateWord(lsiScore)}
                    </p>
                  </div>
                  <div className="flex gap-3.5 pb-1 shrink-0">
                    <MiniMetric label="Temp" value={latest?.temperature ?? null} unit="°C" />
                    <MiniMetric label="Ca Hard." value={latest?.calciumHardness ?? null} unit="ppm" />
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <div className="relative h-1.5 rounded-full bg-surface-2 border border-border-dim" aria-hidden="true">
                    <div className="absolute inset-y-0 left-[40%] right-[40%] bg-success/35" />
                    {lsiScore != null && lsiStatus && (
                      <div
                        className="absolute -top-[5px] w-3.5 h-3.5 rounded-full border-2 border-surface -translate-x-1/2 transition-[left] duration-400"
                        style={{ left: `${lsiMarkerPercent(lsiScore)}%`, backgroundColor: STATUS_UI[lsiStatus].hex, boxShadow: `0 0 0 1px ${STATUS_UI[lsiStatus].hex}` }}
                      />
                    )}
                  </div>
                  <div className="flex justify-between font-mono text-[9px] tracking-[0.1em] uppercase text-ink-dim">
                    <span>−0.5 Corrosive</span><span>0 Balanced</span><span>+0.5 Scaling</span>
                  </div>
                  {lsiScore == null && (
                    <p className="text-[10px] text-ink-dim">Log pH, temperature, calcium hardness and alkalinity to compute LSI.</p>
                  )}
                </div>
              </motion.section>

              {/* Read-only Hanna Cloud connection test: never writes a reading. */}
              <section aria-label="Hanna Cloud connection test" className="rounded-2xl border border-border-dim bg-surface px-4 py-3 md:col-span-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className={LABEL}>Hanna Cloud · Connection test</p>
                    <p className="text-xs text-ink-muted mt-1">Fetch latest controller measurements without saving or changing anything.</p>
                  </div>
                  <button type="button" onClick={handleProbeClick} disabled={probePending}
                    className="shrink-0 rounded-lg bg-surface-2 border border-border-dim px-3 py-2 text-xs font-semibold text-white disabled:opacity-60">
                    {probePending ? 'Testing…' : 'Test connection'}
                  </button>
                </div>
                {probeResult && (
                  <div role="status" className="mt-3 text-xs text-ink-muted">
                    {probeResult.reading
                      ? `Read-only success · pH ${probeResult.reading.ph ?? '—'} · ORP ${probeResult.reading.sanitisationMv ?? '—'} mV · ${probeResult.reading.temperature ?? '—'} °C · Recorded ${new Date(probeResult.reading.recordedAt).toLocaleString()}. Nothing saved.`
                      : 'Hanna Cloud connected, but no usable measurement was returned. Nothing saved.'}
                  </div>
                )}
              </section>

              {/* ── Live telemetry ────────────────────────────────────── */}
              <motion.section {...sectionMotion(section++)} aria-label="Live telemetry" className="flex flex-col gap-3 md:col-span-2 md:row-start-2">
                <div className="flex justify-between items-center px-0.5">
                  <h2 className={LABEL}>Live Telemetry</h2>
                  <button
                    type="button"
                    onClick={() => onLogReading()}
                    className="h-8 pl-2 pr-2.5 rounded-lg bg-surface border border-border-dim flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-ink-muted active:scale-95 transition-transform"
                  >
                    <Plus size={14} aria-hidden="true" />Log Manually
                  </button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <TelemetryCard
                    label="pH" field="ph" unit=""
                    value={latest?.ph ?? null} decimals={1}
                    status={metricStatus(latest?.ph, DEFAULT_RANGES.ph)}
                    trend={getTrendGlyph(readings, 'ph')}
                    ideal="Ideal 7.2–7.6"
                    onOpenTrends={onOpenTrends} onLogReading={onLogReading}
                  />
                  <TelemetryCard
                    label="Free Cl" field="chlorine" unit="ppm"
                    value={latest?.chlorine ?? null} decimals={1}
                    status={metricStatus(latest?.chlorine, DEFAULT_RANGES.chlorine)}
                    trend={getTrendGlyph(readings, 'chlorine')}
                    ideal="Ideal 1–3"
                    onOpenTrends={onOpenTrends} onLogReading={onLogReading}
                  />
                  <TelemetryCard
                    label="ORP" field="sanitisationMv" unit="mV"
                    value={recentOrp?.value ?? null} decimals={0}
                    // ORP has its own three-tier band (650/750/850 mV, see
                    // classifyOrp) rather than the generic 10 % buffer, and the
                    // ideal shown is DEFAULT_RANGES' 650–750 per AGENTS.md — not
                    // the 700–780 the design mock-up happened to use.
                    status={recentOrp ? classifyOrp(recentOrp.value) : null}
                    trend={getTrendGlyph(readings, 'sanitisationMv')}
                    ideal={`Ideal ${DEFAULT_RANGES.sanitisationMv.min}–${DEFAULT_RANGES.sanitisationMv.max}`}
                    caption={orpIsStale && recentOrp ? `As of ${formatAge(recentOrp.at, now)}` : undefined}
                    onOpenTrends={onOpenTrends} onLogReading={onLogReading}
                  />
                  <TelemetryCard
                    label="Alkalinity" field="alkalinity" unit="ppm"
                    value={latest?.alkalinity ?? null} decimals={0}
                    status={metricStatus(latest?.alkalinity, DEFAULT_RANGES.alkalinity)}
                    trend={getTrendGlyph(readings, 'alkalinity')}
                    ideal="Ideal 80–120"
                    onOpenTrends={onOpenTrends} onLogReading={onLogReading}
                  />
                </div>
              </motion.section>
              {/* ── Active AI protocol ────────────────────────────────── */}
              <motion.section {...sectionMotion(section++)} aria-label="Active AI protocol" className={`rounded-2xl bg-surface border border-accent/30 overflow-hidden flex flex-col md:col-start-2 md:row-start-1 ${CARD_SHADOW}`}>
                <div className="flex justify-between items-center px-[18px] pt-3.5">
                  <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-accent">
                    <Sparkles size={14} aria-hidden="true" />Active AI Protocol
                  </p>
                  {protocol && (
                    <p className="font-mono text-[9px] tracking-[0.1em] uppercase text-ink-dim">
                      {protocol.model} · {protocol.generatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  )}
                </div>
                <div className="px-[18px] pt-3 pb-4 flex flex-col gap-3.5">
                  <ProtocolBody state={protocolState} protocol={protocol} hasReading={Boolean(latest)} />
                  <div className="flex gap-2.5">
                    <ProtocolPrimaryButton
                      state={protocolState}
                      protocol={protocol}
                      hasReading={Boolean(latest)}
                      onExecute={onExecuteProtocol}
                      onAnalyze={onRequestProtocol}
                      onLogReading={() => onLogReading()}
                      onOpenTasks={onOpenTasks}
                    />
                    <button
                      type="button"
                      onClick={() => onOpenAssistant(protocol ? 'protocol' : 'menu')}
                      aria-label="Open protocol detail in the AI assistant"
                      className="w-[52px] h-[52px] shrink-0 rounded-xl bg-surface-2 border border-border-dim flex items-center justify-center text-ink-muted active:scale-[0.96] transition-transform"
                    >
                      <ChevronRight size={20} />
                    </button>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onOpenTasks}
                  className="border-t border-border-dim bg-surface-2 px-[18px] py-3 flex items-center gap-3 text-left w-full active:bg-surface transition-colors"
                  aria-label={`Shift checklist, ${tasksDone} of ${tasksTotal} done. Open tasks.`}
                >
                  <ListChecks size={18} className="text-accent shrink-0" aria-hidden="true" />
                  <div className="flex-1 flex flex-col gap-1.5">
                    <div className="flex justify-between text-[10px] font-bold uppercase tracking-[0.14em] text-ink-muted">
                      <span>Shift Checklist</span>
                      <span className="font-mono text-white">{tasksDone}/{tasksTotal}</span>
                    </div>
                    <div className="h-1 rounded-full bg-border-dim overflow-hidden">
                      <div
                        className="h-full bg-accent transition-[width] duration-400 ease-[cubic-bezier(.16,1,.3,1)]"
                        style={{ width: `${tasksTotal === 0 ? 0 : Math.round((tasksDone / tasksTotal) * 100)}%` }}
                      />
                    </div>
                  </div>
                </button>
              </motion.section>

            </div>

            {/* ── Operations ──────────────────────────────────────────── */}
            <motion.section {...sectionMotion(section++)} aria-label="Operations" className="flex flex-col gap-3">
              <h2 className={`${LABEL} px-0.5`}>Operations</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <OperationTile icon={Wrench} title="Equipment" sub={equipmentTile.sub} badge={equipmentTile.badge} onClick={onOpenEquipment} />
                <OperationTile icon={Package} title="Inventory" sub={inventoryTile.sub} badge={inventoryTile.badge} onClick={onOpenInventory} />
                <OperationTile icon={FileText} title="Weekly Report" sub={weekTile.sub} badge={weekTile.badge} onClick={onOpenWeeklyReport} />
                <OperationTile icon={LineChartIcon} title="Trends" sub={describePhDrift(readings, now)} badge={{ text: '7 D', status: 'neutral' }} onClick={() => onOpenTrends('ph')} />
              </div>
            </motion.section>

            {/* ── Connected agents ────────────────────────────────────── */}
            <motion.section {...sectionMotion(section++)} aria-label="Connected agents">
              <button
                type="button"
                onClick={onViewHistory}
                className="w-full flex items-center gap-3 px-3.5 py-3 rounded-xl bg-surface border border-border-dim text-left active:scale-[0.98] transition-transform"
              >
                <span className="w-9 h-9 rounded-lg bg-surface-2 border border-border-dim flex items-center justify-center shrink-0">
                  <Plug size={18} className="text-accent" aria-hidden="true" />
                </span>
                <span className="flex-1 flex flex-col gap-[3px] min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="text-[13px] font-bold text-white">Connected agents</span>
                    <span className={`text-[9px] font-bold tracking-[0.12em] uppercase ${agents.live ? 'text-success-text' : 'text-ink-dim'}`}>
                      ● {agents.live ? 'MCP Live' : 'MCP Ready'}
                    </span>
                  </span>
                  <span className="font-mono text-[10px] text-ink-muted whitespace-nowrap overflow-hidden text-ellipsis">{agents.sub}</span>
                </span>
                <ChevronRight size={18} className="text-ink-dim shrink-0" aria-hidden="true" />
              </button>
            </motion.section>
          </>
        )}
      </div>
    </div>
  );
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function SyncDot({ kind }: { kind: 'live' | 'stale' | 'manual' | 'none' | 'syncing' | 'error' }) {
  if (kind === 'syncing') return <RotateCw size={10} className="text-accent animate-spin shrink-0" aria-hidden="true" />;
  const color = kind === 'live' ? 'bg-emerald-400' : kind === 'stale' ? 'bg-amber-400' : kind === 'error' ? 'bg-red-400' : 'bg-ink-muted';
  return (
    <span
      aria-hidden="true"
      className={`w-2 h-2 rounded-full shrink-0 ${color} ${kind === 'live' ? 'anim-live-pulse shadow-[0_0_0_3px_rgba(16,185,129,0.2)]' : ''}`}
    />
  );
}

function StatusChip({ status }: { status: Status | null }) {
  const ui = status ? STATUS_UI[status] : NEUTRAL_UI;
  return (
    <span className={`inline-flex items-center gap-1.5 text-[10px] font-bold tracking-[0.14em] uppercase px-2.5 py-[5px] rounded-md whitespace-nowrap border ${ui.bg} ${ui.border} ${ui.text}`}>
      {status ? ui.chip : 'No LSI'}
    </span>
  );
}

function MiniMetric({ label, value, unit }: { label: string; value: number | null; unit: string }) {
  return (
    <div className="flex flex-col gap-[3px] items-end">
      <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-ink-dim whitespace-nowrap">{label}</p>
      <p className={`font-mono text-lg font-bold ${value == null ? 'text-ink-dim' : 'text-white'}`}>
        {value == null ? '—' : value}
        <span className="text-[10px] text-ink-dim ml-0.5">{unit}</span>
      </p>
    </div>
  );
}

function TelemetryCard({ label, field, value, unit, decimals, status, trend, ideal, caption, onOpenTrends, onLogReading }: {
  label: string;
  field: NumericReadingField;
  value: number | null;
  unit: string;
  decimals: number;
  status: Status | null;
  trend: string | null;
  ideal: string;
  caption?: string;
  onOpenTrends: (metric: TrendMetricKey) => void;
  onLogReading: (field: NumericReadingField) => void;
}) {
  const ui = status ? STATUS_UI[status] : NEUTRAL_UI;
  // Tap opens this metric's trend chart; holding logs a new reading with
  // this field focused — the same long-press shortcut the previous card
  // layout had, kept so a poolside operator can go straight to the field.
  const { handlers, isPressing } = useLongPress({ onLongPress: () => onLogReading(field), onClick: () => onOpenTrends(field) });
  // The keyboard action matches the label: Enter or Space opens trends. The
  // long-press hook would otherwise log a reading, so override its key handler.
  // Logging stays reachable from the keyboard via the Log Manually button.
  const keyHandlers = {
    ...handlers,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onOpenTrends(field);
      }
    },
  };
  return (
    <div
      {...keyHandlers}
      role="button"
      tabIndex={0}
      aria-label={`${label}${value == null ? ', not measured' : `, ${value} ${unit}`}. Tap for trends, hold to log a reading.`}
      title="Tap for trends · hold to log a reading"
      className={`min-h-[118px] px-3.5 pt-3.5 pb-3 rounded-xl border flex flex-col justify-between gap-2 select-none cursor-pointer transition-transform ${isPressing ? 'scale-[0.97] ring-2 ring-accent/50' : 'active:scale-[0.97]'} ${status ? `${ui.bg} ${ui.border}` : 'bg-surface border-border-dim'}`}
    >
      <div className="flex justify-between items-center gap-1.5">
        <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-ink-muted">{label}</span>
        {trend && <span className={`font-mono text-[10px] ${ui.text}`} aria-hidden="true">{trend}</span>}
      </div>
      <div className="flex items-baseline gap-1">
        <span className={`font-mono text-[32px] font-bold leading-none tabular-nums ${status ? ui.text : 'text-ink-dim'}`}>
          {value == null ? '—' : value.toFixed(decimals)}
        </span>
        {value != null && unit && <span className="text-[11px] text-ink-dim">{unit}</span>}
      </div>
      <div className="flex justify-between items-center text-[9px] font-bold uppercase tracking-[0.12em] text-ink-dim">
        <span>{ideal}</span>
        <span className={status ? ui.text : 'text-ink-dim'}>{status ? ui.chip : 'Not measured'}</span>
      </div>
      {caption && <p className="text-[9px] font-medium text-ink-dim">{caption}</p>}
    </div>
  );
}

function ProtocolBody({ state, protocol, hasReading }: { state: ProtocolState; protocol: AiProtocol | null; hasReading: boolean }) {
  if (state === 'loading') {
    return (
      <p className="flex items-center gap-2.5 text-[15px] leading-[1.45] text-ink-muted" aria-live="polite">
        <Loader2 size={18} className="text-accent animate-spin shrink-0" aria-hidden="true" />
        AI analyzing saturation...
      </p>
    );
  }
  if (state === 'error') {
    return <p className="font-mono text-xs text-critical" role="alert">{PROTOCOL_ERROR_MESSAGE}</p>;
  }
  if (protocol) {
    return <p className="text-[15px] leading-[1.45] text-white [text-wrap:pretty]">{protocolHeadline(protocol)}</p>;
  }
  return (
    <p className="text-[15px] leading-[1.45] text-ink-muted [text-wrap:pretty]">
      {hasReading ? 'Run an AI analysis of the latest reading for a step-by-step protocol.' : 'Log a reading to generate an AI maintenance protocol.'}
    </p>
  );
}

function ProtocolPrimaryButton({ state, protocol, hasReading, onExecute, onAnalyze, onLogReading, onOpenTasks }: {
  state: ProtocolState;
  protocol: AiProtocol | null;
  hasReading: boolean;
  onExecute: () => void;
  onAnalyze: () => void;
  onLogReading: () => void;
  onOpenTasks: () => void;
}) {
  const base = 'flex-1 h-[52px] rounded-xl flex items-center justify-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] transition-transform active:scale-[0.96] disabled:opacity-60 disabled:active:scale-100';
  const primary = `${base} bg-accent text-primary shadow-[0_12px_24px_rgba(79,195,247,0.2)]`;

  if (state === 'executed' && protocol) {
    const n = protocol.checklist.length;
    return (
      <button type="button" onClick={onOpenTasks} className={`${base} bg-surface-2 border border-success/35 text-success-text`}>
        <CheckCircle2 size={16} aria-hidden="true" />Checklist Built · {n} Task{n === 1 ? '' : 's'}
      </button>
    );
  }
  if (state === 'loading') {
    return <button type="button" disabled className={primary}><Loader2 size={16} className="animate-spin" aria-hidden="true" />Analyzing…</button>;
  }
  if (state === 'error') {
    return <button type="button" onClick={onAnalyze} className={primary}><RotateCw size={16} aria-hidden="true" />Retry Analysis</button>;
  }
  if (protocol) {
    return protocol.checklist.length > 0
      ? <button type="button" onClick={onExecute} className={primary}><Play size={16} aria-hidden="true" />Execute Protocol</button>
      : <button type="button" onClick={onOpenTasks} className={primary}><Play size={16} aria-hidden="true" />View Checklist</button>;
  }
  return hasReading
    ? <button type="button" onClick={onAnalyze} className={primary}><Sparkles size={16} aria-hidden="true" />Analyze Readings</button>
    : <button type="button" onClick={onLogReading} className={primary}><Plus size={16} aria-hidden="true" />Log Reading</button>;
}

function OperationTile({ icon: Icon, title, sub, badge, onClick }: {
  icon: React.ComponentType<{ size?: number; className?: string; 'aria-hidden'?: boolean | 'true' }>;
  title: string;
  sub: string;
  badge: TileBadge;
  onClick: () => void;
}) {
  const ui = badge.status === 'neutral' ? NEUTRAL_UI : STATUS_UI[badge.status];
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-[104px] p-3.5 rounded-xl bg-surface border border-border-dim flex flex-col justify-between gap-2.5 text-left active:scale-[0.97] transition-transform"
    >
      <span className="flex justify-between items-center w-full">
        <Icon size={20} className="text-ink-muted" aria-hidden="true" />
        <span className={`text-[9px] font-bold uppercase tracking-[0.12em] px-[7px] py-[3px] rounded-md border ${ui.bg} ${ui.border} ${ui.text}`}>{badge.text}</span>
      </span>
      <span className="flex flex-col gap-[3px] min-w-0">
        <span className="text-[13px] font-bold text-white">{title}</span>
        <span className="font-mono text-[10px] leading-[1.4] text-ink-muted">{sub}</span>
      </span>
    </button>
  );
}

function DashboardSkeleton() {
  const block = 'rounded-xl bg-surface border border-border-dim animate-pulse';
  return (
    <div className="flex flex-col gap-5" aria-busy="true" aria-label="Loading pool data">
      <div className={`${block} rounded-2xl h-[196px]`} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => <div key={i} className={`${block} h-[118px]`} />)}
      </div>
      <div className={`${block} rounded-2xl h-[210px]`} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => <div key={i} className={`${block} h-[104px]`} />)}
      </div>
    </div>
  );
}
