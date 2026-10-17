import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import Dashboard, { AssistantOpenMode } from './components/Dashboard';
import Tasks from './components/Tasks';
import TrendsView from './components/TrendsView';
import TabBar, { Tab } from './components/TabBar';
import MoreSheet from './components/MoreSheet';
import ProtocolConfirm from './components/ProtocolConfirm';
import { suggestedProductsFromStock } from './lib/protocolConfirm';
import ReadingForm from './components/ReadingForm';
import CheatSheet from './components/CheatSheet';
import OfflineIndicator from './components/OfflineIndicator';
import GeminiAssistant, { AssistantMode } from './components/GeminiAssistant';
import History from './components/History';
import Glossary from './components/Glossary';
import ReminderSettings from './components/ReminderSettings';
import Inventory from './components/Inventory';
import Equipment from './components/Equipment';
import Wishlist from './components/Wishlist';
import WeeklyReport from './components/WeeklyReport';
import WorkTracker from './components/WorkTracker';
import ControllerImport from './components/ControllerImport';
import { useModalFocus } from './lib/useModalFocus';
import { Reading, MaintenanceTask, MaintenanceSchedule, Frequency, InventoryItem, EquipmentItem, WishlistItem, WorkSession } from './types';
import { auth, db, storage, signIn, logout, handleFirestoreError, OperationType } from './firebase';
import { deleteObject, ref as storageRef } from 'firebase/storage';
import { useToast } from './lib/toast';
import { getLatestReadingForDisplay } from './lib/readings';
import { NUMERIC_READING_FIELDS, NumericReadingField } from './lib/readingValidation';
import { AiProtocol, ProtocolState, protocolToTasks, requestAiProtocol } from './lib/aiProtocol';
import { TrendMetricKey } from './lib/trends';
import { onAuthStateChanged, User } from 'firebase/auth';
import { collection, query, where, onSnapshot, doc, setDoc, updateDoc, deleteDoc, Timestamp, orderBy, getDoc, addDoc, runTransaction } from 'firebase/firestore';
import { LogIn, User as UserIcon, X } from 'lucide-react';
import { DEFAULT_POOL_TASKS, DEFAULT_INVENTORY, DEFAULT_EQUIPMENT } from './types';

interface PendingScheduleUpdate {
  lastTestMs: number;
  testFrequency: Frequency;
  remindersEnabled: boolean;
}

const FREQUENCY_DAYS: Record<Frequency, number> = { daily: 1, weekly: 7, biweekly: 14, monthly: 30 };

const pendingScheduleKey = (uid: string) => `poolstatus:pendingSchedule:${uid}`;

function readPendingSchedule(uid: string): PendingScheduleUpdate | null {
  try {
    const raw = localStorage.getItem(pendingScheduleKey(uid));
    return raw ? (JSON.parse(raw) as PendingScheduleUpdate) : null;
  } catch {
    return null;
  }
}

// Keeps only the latest pending update: an older one must never replace a newer
// one. Returns false when storage is unavailable, so the caller keeps the update
// in memory and writes it straight away instead.
function queuePendingSchedule(uid: string, update: PendingScheduleUpdate): boolean {
  try {
    const existing = readPendingSchedule(uid);
    if (existing && existing.lastTestMs >= update.lastTestMs) return true;
    localStorage.setItem(pendingScheduleKey(uid), JSON.stringify(update));
    return true;
  } catch {
    return false;
  }
}

function clearPendingSchedule(uid: string) {
  try {
    localStorage.removeItem(pendingScheduleKey(uid));
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}

// Drops the update queued for a reading whose own save definitively failed, so a
// schedule for a test that was never recorded is never applied. An update that
// was queued earlier, and replaced by this one, is put back.
function discardPendingSchedule(uid: string, update: PendingScheduleUpdate, previous: PendingScheduleUpdate | null) {
  if (readPendingSchedule(uid)?.lastTestMs !== update.lastTestMs) return;
  try {
    if (previous) localStorage.setItem(pendingScheduleKey(uid), JSON.stringify(previous));
    else localStorage.removeItem(pendingScheduleKey(uid));
  } catch {
    // Storage is unavailable, so there's nothing persisted to restore.
  }
}

// Writes the schedule only if no later test is already recorded, inside one
// transaction, so another tab or device's newer test is never overwritten.
async function writeScheduleIfLatest(uid: string, update: PendingScheduleUpdate) {
  const scheduleRef = doc(db, 'schedules', uid);
  await runTransaction(db, async (transaction) => {
    const current = await transaction.get(scheduleRef);
    const storedLast = current.exists() ? (current.data().lastTestDate as Timestamp | null) : null;
    if (storedLast && storedLast.toMillis() > update.lastTestMs) return;
    // Use the frequency as stored now, not as it was when the reading was saved,
    // so a change made on another device is respected.
    const frequency = (current.exists() ? current.data().testFrequency as Frequency | undefined : undefined) ?? update.testFrequency;
    const nextTest = new Date(update.lastTestMs);
    nextTest.setDate(nextTest.getDate() + FREQUENCY_DAYS[frequency]);
    transaction.set(scheduleRef, {
      uid,
      lastTestDate: Timestamp.fromMillis(update.lastTestMs),
      nextTestDate: Timestamp.fromDate(nextTest),
      // Rules require these on create. An existing schedule keeps its own settings.
      ...(current.exists() ? {} : {
        testFrequency: update.testFrequency,
        remindersEnabled: update.remindersEnabled,
      }),
    }, { merge: true });
  });
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [readings, setReadings] = useState<Reading[]>([]);
  const [tasks, setTasks] = useState<MaintenanceTask[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [equipment, setEquipment] = useState<EquipmentItem[]>([]);
  const [wishlist, setWishlist] = useState<WishlistItem[]>([]);
  const [workSessions, setWorkSessions] = useState<WorkSession[]>([]);
  const [geoAutoStartEnabled, setGeoAutoStartEnabled] = useState(false);
  const [schedule, setSchedule] = useState<MaintenanceSchedule>({
    uid: '',
    testFrequency: 'weekly',
    lastTestDate: null,
    nextTestDate: null,
    remindersEnabled: false,
  });

  const [isLogging, setIsLogging] = useState(false);
  const [historicLogTimestamp, setHistoricLogTimestamp] = useState<Date | null>(null);
  // The control that opened the historic form, so focus can return to it.
  const historicReturnFocusRef = useRef<HTMLElement | null>(null);
  const [logFocusField, setLogFocusField] = useState<NumericReadingField | undefined>(undefined);
  const [editingReading, setEditingReading] = useState<Reading | null>(null);
  const [editFocusField, setEditFocusField] = useState<NumericReadingField | undefined>(undefined);
  const [returnToHistoryAfterEdit, setReturnToHistoryAfterEdit] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isCheatSheetOpen, setIsCheatSheetOpen] = useState(false);
  const [isGlossaryOpen, setIsGlossaryOpen] = useState(false);
  const [isReminderSettingsOpen, setIsReminderSettingsOpen] = useState(false);
  const [isControllerImportOpen, setIsControllerImportOpen] = useState(false);
  const [isInventoryOpen, setIsInventoryOpen] = useState(false);
  const [isEquipmentOpen, setIsEquipmentOpen] = useState(false);
  const [isWeeklyReportOpen, setIsWeeklyReportOpen] = useState(false);
  const [isWishlistOpen, setIsWishlistOpen] = useState(false);
  const [isTasksOpen, setIsTasksOpen] = useState(false);
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [isWorkTrackerOpen, setIsWorkTrackerOpen] = useState(false);
  const workTrackerRef = useModalFocus<HTMLDivElement>(isWorkTrackerOpen, () => setIsWorkTrackerOpen(false));
  const [trendsView, setTrendsView] = useState<{ focusMetric?: TrendMetricKey } | null>(null);
  const [assistantMode, setAssistantMode] = useState<AssistantMode | null>(null);
  // False until the readings listener's first snapshot: lets the dashboard
  // show a loading skeleton instead of "no data" during the initial fetch.
  const [readingsLoaded, setReadingsLoaded] = useState(false);
  // The AI maintenance protocol is shared by the dashboard's protocol card
  // and the assistant sheet, so it lives here rather than in either.
  const [protocol, setProtocol] = useState<AiProtocol | null>(null);
  const [protocolState, setProtocolState] = useState<ProtocolState>('idle');
  const protocolRequestId = useRef(0);
  // True while a protocol save is in flight, so a second tap can't write duplicate tasks.
  const protocolExecuting = useRef(false);
  // Pending confirmation for an execute request: its resolver, and the
  // protocol request it was opened for (so a replaced protocol is not saved).
  const [protocolConfirmOpen, setProtocolConfirmOpen] = useState(false);
  const protocolConfirmResolve = useRef<((saved: boolean) => void) | null>(null);
  const protocolConfirmRunId = useRef(0);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [lastSaved, setLastSaved] = useState<Date | undefined>();
  const [reportEntries, setReportEntries] = useState<{ timestamp: string; summary: string }[]>([]);
  const [reportTemplate, setReportTemplate] = useState<string>('');
  const geoStartInFlight = useRef(false);
  const toast = useToast();

  const markSaved = (message: string) => {
    setLastSaved(new Date());
    toast.success(message);
  };

  // Auth listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setIsAuthReady(true);
    });
    return unsubscribe;
  }, []);

  // Firestore sync
  useEffect(() => {
    // Protocol state is App-wide, so a sign-out or account switch must drop
    // the previous account's checklist and invalidate any request still in
    // flight (its id no longer matches, so its result is ignored).
    protocolRequestId.current++;
    setProtocol(null);
    setProtocolState('idle');

    if (!user) {
      setReadings([]);
      setReadingsLoaded(false);
      setTasks([]);
      setInventory([]);
      setEquipment([]);
      setWishlist([]);
      setWorkSessions([]);
      return;
    }

    const readingsQuery = query(collection(db, 'readings'), where('uid', '==', user.uid), orderBy('timestamp', 'desc'));
    const tasksQuery = query(collection(db, 'tasks'), where('uid', '==', user.uid), orderBy('createdAt', 'desc'));
    const inventoryQuery = query(collection(db, 'inventory'), where('uid', '==', user.uid));
    const equipmentQuery = query(collection(db, 'equipment'), where('uid', '==', user.uid));
    const wishlistQuery = query(collection(db, 'wishlist'), where('uid', '==', user.uid));
    const sessionsQuery = query(collection(db, 'workSessions'), where('uid', '==', user.uid), orderBy('startTime', 'desc'));
    const scheduleDoc = doc(db, 'schedules', user.uid);

    const unsubReadings = onSnapshot(readingsQuery, (snapshot) => {
      setReadings(snapshot.docs.map(doc => ({
        ...doc.data(),
        totalChlorine: doc.data().totalChlorine ?? null,
        sanitisationMv: doc.data().sanitisationMv ?? null,
        timestamp: (doc.data().timestamp as Timestamp).toDate(),
        editedAt: doc.data().editedAt ? (doc.data().editedAt as Timestamp).toDate() : undefined,
      } as Reading)));
      setReadingsLoaded(true);
    }, (err) => {
      // Leave the loading skeleton on failure too, so "Log Manually" stays reachable.
      setReadingsLoaded(true);
      handleFirestoreError(err, OperationType.LIST, 'readings');
    });

    const unsubTasks = onSnapshot(tasksQuery, (snapshot) => {
      if (snapshot.empty && user) {
        Promise.all(DEFAULT_POOL_TASKS.map((task) => {
          const newTaskRef = doc(collection(db, 'tasks'));
          return setDoc(newTaskRef, {
            ...task,
            id: newTaskRef.id,
            uid: user.uid,
            createdAt: Timestamp.fromDate(new Date())
          });
        })).catch(err => handleFirestoreError(err, OperationType.WRITE, 'tasks'));
      }
      setTasks(snapshot.docs.map(doc => ({
        ...doc.data(),
        id: doc.id,
        createdAt: (doc.data().createdAt as Timestamp).toDate()
      } as MaintenanceTask)));
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'tasks'));

    const unsubInventory = onSnapshot(inventoryQuery, (snapshot) => {
      if (snapshot.empty && user) {
        Promise.all(DEFAULT_INVENTORY.map((item) => {
          const newItemRef = doc(collection(db, 'inventory'));
          return setDoc(newItemRef, {
            ...item,
            id: newItemRef.id,
            uid: user.uid
          });
        })).catch(err => handleFirestoreError(err, OperationType.WRITE, 'inventory'));
      }
      setInventory(snapshot.docs.map(doc => doc.data() as InventoryItem));
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'inventory'));

    const unsubEquipment = onSnapshot(equipmentQuery, (snapshot) => {
      if (snapshot.empty && user) {
        Promise.all(DEFAULT_EQUIPMENT.map((item) => {
          const newItemRef = doc(collection(db, 'equipment'));
          return setDoc(newItemRef, {
            ...item,
            id: newItemRef.id,
            uid: user.uid,
            installDate: Timestamp.fromDate(item.installDate)
          });
        })).catch(err => handleFirestoreError(err, OperationType.WRITE, 'equipment'));
      }
      setEquipment(snapshot.docs.map(doc => ({
        ...doc.data(),
        id: doc.id,
        installDate: (doc.data().installDate as Timestamp).toDate(),
        lastServiceDate: doc.data().lastServiceDate ? (doc.data().lastServiceDate as Timestamp).toDate() : undefined
      } as EquipmentItem)));
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'equipment'));

    const unsubWishlist = onSnapshot(wishlistQuery, (snapshot) => {
      const items = snapshot.docs.map(doc => {
        const data = doc.data();
        const rawOptions = Array.isArray(data.purchaseOptions) ? data.purchaseOptions : [];
        const purchaseOptions = rawOptions
          .filter((opt: unknown): opt is Record<string, unknown> =>
            typeof opt === 'object' && opt !== null && typeof (opt as { id?: unknown }).id === 'string'
          )
          .map((opt) => ({
            id: String(opt.id),
            vendor: typeof opt.vendor === 'string' ? opt.vendor : '',
            url: typeof opt.url === 'string' ? opt.url : '',
            price: typeof opt.price === 'number' ? opt.price : undefined,
            currency: typeof opt.currency === 'string' ? opt.currency : '',
            qualityRating: typeof opt.qualityRating === 'number' ? opt.qualityRating : undefined,
            availability: typeof opt.availability === 'string' ? opt.availability : '',
            notes: typeof opt.notes === 'string' ? opt.notes : '',
          }));
        return {
          id: doc.id,
          name: typeof data.name === 'string' ? data.name : '',
          description: typeof data.description === 'string' ? data.description : '',
          priority: ['low', 'medium', 'high', 'critical'].includes(data.priority) ? data.priority : 'medium',
          quantity: typeof data.quantity === 'number' ? data.quantity : 1,
          estimatedCost: typeof data.estimatedCost === 'number' ? data.estimatedCost : undefined,
          currency: typeof data.currency === 'string' ? data.currency : '',
          purchaseOptions,
          uid: typeof data.uid === 'string' ? data.uid : '',
          createdAt: data.createdAt ? (data.createdAt as Timestamp).toDate() : new Date(),
        } as WishlistItem;
      });
      items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      setWishlist(items);
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'wishlist'));


    const unsubSessions = onSnapshot(sessionsQuery, (snapshot) => {
      setWorkSessions(snapshot.docs.map((sessionDoc) => {
        const data = sessionDoc.data();
        return {
          ...data,
          id: sessionDoc.id,
          startTime: (data.startTime as Timestamp).toDate(),
          endTime: data.endTime ? (data.endTime as Timestamp).toDate() : null,
        } as WorkSession;
      }));
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'workSessions'));

    const unsubSchedule = onSnapshot(scheduleDoc, (doc) => {
      if (doc.exists()) {
        const data = doc.data();
        setSchedule({
          ...data,
          lastTestDate: data.lastTestDate ? (data.lastTestDate as Timestamp).toDate() : null,
          nextTestDate: data.nextTestDate ? (data.nextTestDate as Timestamp).toDate() : null,
        } as MaintenanceSchedule);
      }
    }, (err) => handleFirestoreError(err, OperationType.GET, `schedules/${user.uid}`));

    return () => {
      unsubReadings();
      unsubTasks();
      unsubInventory();
      unsubEquipment();
      unsubWishlist();
      unsubSessions();
      unsubSchedule();
    };
  }, [user]);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (schedule.remindersEnabled && schedule.nextTestDate) {
      const now = new Date();
      const nextTest = new Date(schedule.nextTestDate);
      
      if (now >= nextTest) {
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification('Pool Maintenance Required', {
            body: 'It is time for your scheduled water test.',
            icon: '/favicon.ico'
          });
        }
      }
    }
  }, [schedule]);


  const activeSession = workSessions.find((session) => !session.endTime) || null;

  const handleStartWorkSession = async (source: 'manual' | 'geo') => {
    if (!user || activeSession) return;
    try {
      await addDoc(collection(db, 'workSessions'), {
        uid: user.uid,
        startTime: Timestamp.fromDate(new Date()),
        endTime: null,
        source,
        locationLabel: source === 'geo' ? 'Joy Lane' : 'Manual start',
      });
      markSaved(source === 'geo' ? 'Work session auto-started' : 'Work session started');
    } catch (error) {
      toast.error('Could not start work session');
      handleFirestoreError(error, OperationType.CREATE, 'workSessions');
    }
  };

  const handleStopWorkSession = async () => {
    if (!activeSession) return;

    try {
      await updateDoc(doc(db, 'workSessions', activeSession.id), {
        endTime: Timestamp.fromDate(new Date())
      });
      markSaved('Work session ended');
    } catch (err) {
      toast.error('Could not end work session');
      handleFirestoreError(err, OperationType.WRITE, `workSessions/${activeSession.id}`);
    }
  };

  useEffect(() => {
    if (!geoAutoStartEnabled || !user || activeSession || !('geolocation' in navigator)) return;
    const joyLane = { latitude: 30.266, longitude: -97.743 };
    const watchId = navigator.geolocation.watchPosition((position) => {
      const toRad = (v: number) => (v * Math.PI) / 180;
      const dLat = toRad(position.coords.latitude - joyLane.latitude);
      const dLon = toRad(position.coords.longitude - joyLane.longitude);
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(joyLane.latitude)) * Math.cos(toRad(position.coords.latitude)) * Math.sin(dLon / 2) ** 2;
      const meters = 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      if (meters < 120 && !geoStartInFlight.current) {
        geoStartInFlight.current = true;
        navigator.geolocation.clearWatch(watchId);
        handleStartWorkSession('geo').finally(() => {
          geoStartInFlight.current = false;
        });
      }
    });
    return () => navigator.geolocation.clearWatch(watchId);
  }, [geoAutoStartEnabled, user, activeSession]);

  // Writes any queued schedule update. A failure keeps it queued, so the next
  // launch or reconnect retries it; online failures are also reported.
  const flushPendingSchedule = async (uid: string, unpersisted?: PendingScheduleUpdate) => {
    const pending = unpersisted ?? readPendingSchedule(uid);
    if (!pending) return;
    try {
      await writeScheduleIfLatest(uid, pending);
      // Only clear the queue if no newer update was queued while the write ran.
      if (!unpersisted && readPendingSchedule(uid)?.lastTestMs === pending.lastTestMs) {
        clearPendingSchedule(uid);
      }
    } catch (err) {
      if (navigator.onLine) {
        console.error('Schedule update failed; it stays queued:', err);
        toast.error('Reading saved, but the test schedule could not be updated');
      }
    }
  };

  useEffect(() => {
    if (!user) return;
    void flushPendingSchedule(user.uid);
    const retryWhenOnline = () => void flushPendingSchedule(user.uid);
    window.addEventListener('online', retryWhenOnline);
    return () => window.removeEventListener('online', retryWhenOnline);
    // flushPendingSchedule only reads the queue and the uid, so it's safe to
    // run once per signed-in user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

  const restoreHistoricFocus = () => {
    const target = historicReturnFocusRef.current;
    historicReturnFocusRef.current = null;
    // Wait for the calendar to be shown again before moving focus into it.
    requestAnimationFrame(() => target?.focus());
  };

  const handleSaveReading = async (
    newReading: Omit<Reading, 'id' | 'timestamp' | 'uid'>,
    formTimestamp: Date,
  ) => {
    if (!user) return;
    // A historic entry (added from a past day in the calendar) keeps the
    // timestamp the user picked. Only a log dated before today must leave the
    // test schedule alone; decide that from the submitted timestamp, since the
    // operator can edit it.
    const isHistoricEntry = historicLogTimestamp !== null;
    const timestamp = isHistoricEntry ? formTimestamp : new Date();
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    // Never move the schedule backward: a backfilled log must not replace a
    // later test that is already recorded as the last one.
    const updatesSchedule =
      (!isHistoricEntry || timestamp >= startOfToday) &&
      (!schedule.lastTestDate || timestamp > schedule.lastTestDate);
    const id = Date.now().toString();
    const reading: Reading = {
      ...newReading,
      id,
      timestamp,
      uid: user.uid
    };
    // A reading with no actual measurements doesn't count as a completed water
    // test, so it shouldn't advance the schedule and suppress the next reminder.
    const hasMeasurement =
      newReading.chlorine != null ||
      newReading.totalChlorine != null ||
      newReading.sanitisationMv != null ||
      newReading.ph != null ||
      newReading.alkalinity != null ||
      newReading.temperature != null ||
      newReading.differentialPressure != null ||
      newReading.calciumHardness != null ||
      newReading.cyanuricAcid != null;

    // Queue the schedule update before the reading write. An offline write
    // doesn't resolve until it syncs, so queueing after it would lose the update.
    let queuedUpdate: PendingScheduleUpdate | null = null;
    let previousPending: PendingScheduleUpdate | null = null;
    let unpersistedSchedule: PendingScheduleUpdate | null = null;
    if (hasMeasurement && updatesSchedule) {
      previousPending = readPendingSchedule(user.uid);
      queuedUpdate = {
        lastTestMs: timestamp.getTime(),
        testFrequency: schedule.testFrequency,
        remindersEnabled: schedule.remindersEnabled,
      };
      if (!queuePendingSchedule(user.uid, queuedUpdate)) unpersistedSchedule = queuedUpdate;
    }

    try {
      await setDoc(doc(db, 'readings', id), {
        ...reading,
        timestamp: Timestamp.fromDate(timestamp)
      });
      void flushPendingSchedule(user.uid, unpersistedSchedule ?? undefined);

      if (!hasMeasurement) {
        markSaved('Note saved to database');
        setIsLogging(false);
        setHistoricLogTimestamp(null);
        if (isHistoricEntry) restoreHistoricFocus();
        return;
      }

      markSaved('Reading saved to database');
      setIsLogging(false);
      setHistoricLogTimestamp(null);
      if (isHistoricEntry) restoreHistoricFocus();
    } catch (err) {
      // The reading itself failed, so its schedule update must not be applied.
      if (queuedUpdate) discardPendingSchedule(user.uid, queuedUpdate, previousPending);
      toast.error('Could not save reading');
      handleFirestoreError(err, OperationType.WRITE, `readings/${id}`);
    }
  };

  const handleUpdateReading = async (
    id: string,
    previous: Reading,
    updates: Omit<Reading, 'id' | 'timestamp' | 'uid'>,
  ): Promise<boolean> => {
    if (!user) return false;
    // Track which fields actually changed so History can show what the
    // reading used to say, struck through, next to the amended value.
    const previousValues: Partial<Record<NumericReadingField, number | null>> = {};
    for (const field of NUMERIC_READING_FIELDS) {
      if (previous[field] !== updates[field]) {
        previousValues[field] = previous[field] ?? null;
      }
    }
    const hasNumericChanges = Object.keys(previousValues).length > 0;
    const notesChanged = (previous.notes ?? '') !== (updates.notes ?? '');
    try {
      await updateDoc(doc(db, 'readings', id), {
        chlorine: updates.chlorine,
        totalChlorine: updates.totalChlorine ?? null,
        sanitisationMv: updates.sanitisationMv ?? null,
        ph: updates.ph,
        alkalinity: updates.alkalinity,
        temperature: updates.temperature,
        differentialPressure: updates.differentialPressure,
        calciumHardness: updates.calciumHardness,
        cyanuricAcid: updates.cyanuricAcid,
        notes: updates.notes ?? '',
        ...(hasNumericChanges ? { previousValues } : {}),
        ...(hasNumericChanges || notesChanged ? { editedAt: Timestamp.now() } : {}),
      });
      markSaved('Reading updated');
      return true;
    } catch (err) {
      toast.error('Could not update reading');
      handleFirestoreError(err, OperationType.UPDATE, `readings/${id}`);
      return false;
    }
  };

  const handleDeleteReading = async (id: string) => {
    const photoUrl = readings.find(r => r.id === id)?.photoUrl;
    try {
      await deleteDoc(doc(db, 'readings', id));
      markSaved('Reading deleted');
    } catch (err) {
      toast.error('Could not delete reading');
      handleFirestoreError(err, OperationType.DELETE, `readings/${id}`);
      return;
    }
    // Best-effort only: an MCP-logged reading's evidence photo lives in
    // Storage, not Firestore, so deleting the doc above doesn't remove it.
    // No storage.rules exist yet to actually allow this from the client,
    // so today this quietly no-ops — but it costs nothing to attempt, and
    // it starts working the moment ownership-scoped rules are added,
    // without another deploy. Never lets a Storage failure block or
    // surface as "could not delete reading" — the reading itself is
    // already gone.
    if (photoUrl) {
      deleteObject(storageRef(storage, photoUrl)).catch((err) => {
        console.error('Could not delete reading photo from Storage', err);
      });
    }
  };

  const toggleTask = async (id: string) => {
    const task = tasks.find(t => t.id === id);
    if (!task) return;
    try {
      await updateDoc(doc(db, 'tasks', id), { completed: !task.completed });
      markSaved(task.completed ? 'Task reopened' : 'Task completed');
    } catch (err) {
      toast.error('Could not update task');
      handleFirestoreError(err, OperationType.UPDATE, `tasks/${id}`);
    }
  };

  // Resolves true only when every task write succeeded, so the caller can
  // mark the protocol executed only once its checklist really exists.
  const handleExecuteProtocol = async (newTasks: MaintenanceTask[]): Promise<boolean> => {
    if (!user) return false;
    try {
      // Delete old uncompleted AI tasks
      const staleAiTasks = tasks.filter(t => t.isAI && !t.completed);
      await Promise.all(staleAiTasks.map(t => deleteDoc(doc(db, 'tasks', t.id))));

      // Add new tasks
      await Promise.all(newTasks.map(t => setDoc(doc(db, 'tasks', t.id), {
        ...t,
        uid: user.uid,
        createdAt: Timestamp.fromDate(new Date())
      })));
      markSaved(`Protocol saved (${newTasks.length} task${newTasks.length === 1 ? '' : 's'})`);
      return true;
    } catch (err) {
      toast.error('Could not save protocol');
      handleFirestoreError(err, OperationType.WRITE, 'tasks');
      return false;
    }
  };

  const latestForAi = getLatestReadingForDisplay(readings);
  const hasLatestReading = latestForAi != null;

  // With no readings left, any protocol was built from evidence that no
  // longer exists, so it must not stay executable.
  useEffect(() => {
    if (hasLatestReading) return;
    protocolRequestId.current++;
    setProtocol(null);
    setProtocolState('idle');
  }, [hasLatestReading]);

  // Requests a fresh AI protocol for the latest reading. The request id
  // guards against an older in-flight response landing after a newer one
  // (StrictMode's double effect run, or an operator tapping Analyze while a
  // reading-change auto-run is still pending).
  const handleRequestProtocol = async () => {
    if (!latestForAi) return;
    const requestId = ++protocolRequestId.current;
    // Drop the previous checklist now: it was built from readings that have
    // since changed, so it must not stay executable while (or after) a refresh runs.
    setProtocol(null);
    setProtocolState('loading');
    try {
      const next = await requestAiProtocol(latestForAi, readings, inventory);
      if (requestId !== protocolRequestId.current) return;
      setProtocol(next);
      setProtocolState('ready');
    } catch (err) {
      console.error('AI Error:', err);
      if (requestId !== protocolRequestId.current) return;
      setProtocolState('error');
    }
  };

  // Resolves true only when the checklist was saved, so the assistant shows
  // its "staged" confirmation only for a real save. A second call while a
  // save is pending is ignored, and the protocol is marked executed only if
  // it is still the current one when the save finishes: a refresh that
  // started meanwhile has replaced it, and its checklist was never saved.
  const handleExecuteCurrentProtocol = async (confirmedProducts?: string): Promise<boolean> => {
    if (!protocol || protocol.checklist.length === 0 || protocolExecuting.current) return false;
    protocolExecuting.current = true;
    const runId = protocolRequestId.current;
    try {
      const saved = await handleExecuteProtocol(protocolToTasks(protocol, confirmedProducts));
      if (saved && protocolRequestId.current === runId) setProtocolState('executed');
      return saved;
    } finally {
      protocolExecuting.current = false;
    }
  };

  // Execute goes through a confirmation first. Resolves true only when the
  // checklist was saved; cancelling resolves false and saves nothing.
  const requestExecuteProtocol = (): Promise<boolean> => {
    if (!protocol || protocol.checklist.length === 0 || protocolExecuting.current || protocolConfirmResolve.current) {
      return Promise.resolve(false);
    }
    protocolConfirmRunId.current = protocolRequestId.current;
    return new Promise<boolean>((resolve) => {
      protocolConfirmResolve.current = resolve;
      setProtocolConfirmOpen(true);
    });
  };

  const settleProtocolConfirm = async (confirmed: boolean, products = '') => {
    const resolve = protocolConfirmResolve.current;
    protocolConfirmResolve.current = null;
    setProtocolConfirmOpen(false);
    if (!resolve) return;
    if (!confirmed) {
      resolve(false);
      return;
    }
    // A refresh or account change while the dialog was open replaced the
    // checklist the operator confirmed, so stop rather than save a different one.
    if (protocolRequestId.current !== protocolConfirmRunId.current) {
      toast.info('The protocol changed while you were confirming. Review it and confirm again.');
      resolve(false);
      return;
    }
    resolve(await handleExecuteCurrentProtocol(products));
  };

  const handleUpdateSchedule = async (newSchedule: MaintenanceSchedule) => {
    if (!user) return;
    try {
      await setDoc(doc(db, 'schedules', user.uid), {
        ...newSchedule,
        uid: user.uid,
        lastTestDate: newSchedule.lastTestDate ? Timestamp.fromDate(newSchedule.lastTestDate) : null,
        nextTestDate: newSchedule.nextTestDate ? Timestamp.fromDate(newSchedule.nextTestDate) : null,
      });
      markSaved('Schedule updated');
    } catch (err) {
      toast.error('Could not update schedule');
      handleFirestoreError(err, OperationType.WRITE, `schedules/${user.uid}`);
    }
  };

  // Manual "sync now" trigger for the Hanna Cloud pool controller telemetry
  // job (see CLAUDE.md's "Pool controller telemetry" section) — the same
  // endpoint the scheduled cron/GitHub Actions triggers hit, but
  // authenticated with this signed-in user's own Firebase ID token instead
  // of CRON_SECRET, which must stay server-side only. Returns the sync
  // result so the caller (Dashboard's status light) can reflect it, and
  // throws on failure rather than swallowing it — the caller decides how to
  // show that.
  const handleSyncPoolController = async (): Promise<{ written: boolean; outcome?: string }> => {
    if (!user) throw new Error('Not signed in');
    const idToken = await user.getIdToken();
    const response = await fetch('/api/cron/sync-pool-controller', {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}` },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body?.error || `Sync failed (${response.status})`);
    }
    if (body.written) {
      toast.success('Synced latest reading from pool controller');
    } else if (body.outcome === 'no-reading-available') {
      toast.info('Pool controller has no new reading to sync');
    } else {
      toast.info('Already up to date');
    }
    return body;
  };

  // Query Hanna Cloud without saving anything to Firestore. Unlike the
  // existing manual sync button, this is safe for initial connection tests.
  const handleProbePoolController = async () => {
    if (!user) throw new Error('Not signed in');
    const idToken = await user.getIdToken();
    const response = await fetch('/api/cron/sync-pool-controller?mode=probe', {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}` },
      cache: 'no-store',
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error || `Connection test failed (${response.status})`);
    return body as { written: false; outcome: string; reading: { ph: number | null; sanitisationMv: number | null; temperature: number | null; recordedAt: string } | null };
  };

  const handleAddTask = async (task: Omit<MaintenanceTask, 'id' | 'uid' | 'createdAt'>) => {
    if (!user) return;
    try {
      const newTaskRef = doc(collection(db, 'tasks'));
      await setDoc(newTaskRef, {
        ...task,
        id: newTaskRef.id,
        uid: user.uid,
        createdAt: Timestamp.fromDate(new Date())
      });
      markSaved('Task added');
    } catch (err) {
      toast.error('Could not add task');
      handleFirestoreError(err, OperationType.WRITE, `tasks`);
    }
  };

  const handleUpdateInventory = async (item: InventoryItem) => {
    if (!user) return;
    try {
      await setDoc(doc(db, 'inventory', item.id), { ...item, uid: user.uid });
      markSaved(`Saved ${item.name}`);
    } catch (err) {
      toast.error(`Could not save ${item.name}`);
      handleFirestoreError(err, OperationType.WRITE, `inventory/${item.id}`);
    }
  };

  const handleUpdateEquipment = async (item: EquipmentItem) => {
    if (!user) return;
    try {
      await setDoc(doc(db, 'equipment', item.id), {
        ...item,
        uid: user.uid,
        installDate: Timestamp.fromDate(item.installDate),
        lastServiceDate: item.lastServiceDate ? Timestamp.fromDate(item.lastServiceDate) : null
      });
      markSaved(`Saved ${item.name}`);
    } catch (err) {
      toast.error(`Could not save ${item.name}`);
      handleFirestoreError(err, OperationType.WRITE, `equipment/${item.id}`);
    }
  };

  const handleDeleteInventory = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'inventory', id));
      markSaved('Inventory item removed');
    } catch (err) {
      toast.error('Could not remove inventory item');
      handleFirestoreError(err, OperationType.DELETE, `inventory/${id}`);
    }
  };

  const handleDeleteEquipment = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'equipment', id));
      markSaved('Equipment removed');
    } catch (err) {
      toast.error('Could not remove equipment');
      handleFirestoreError(err, OperationType.DELETE, `equipment/${id}`);
    }
  };

  const handleUpdateWishlist = async (item: WishlistItem) => {
    if (!user) return;
    try {
      const isFiniteNumber = (value: unknown): value is number =>
        typeof value === 'number' && Number.isFinite(value);

      const name = item.name.trim();
      if (!name) {
        throw new Error('Wishlist item name is required.');
      }

      const createdAt =
        item.createdAt instanceof Date && !Number.isNaN(item.createdAt.getTime())
          ? item.createdAt
          : new Date();

      const priority = ['low', 'medium', 'high', 'critical'].includes(item.priority) ? item.priority : 'medium';
      const quantity = isFiniteNumber(item.quantity) ? Math.max(1, item.quantity) : 1;
      const estimatedCost = isFiniteNumber(item.estimatedCost) ? item.estimatedCost : null;

      const cleanOptions = (item.purchaseOptions || []).map((opt) => ({
        id: typeof opt.id === 'string' && opt.id ? opt.id : crypto.randomUUID(),
        vendor: typeof opt.vendor === 'string' ? opt.vendor : '',
        url: typeof opt.url === 'string' ? opt.url : '',
        price: isFiniteNumber(opt.price) ? opt.price : null,
        currency: typeof opt.currency === 'string' ? opt.currency : '',
        qualityRating: isFiniteNumber(opt.qualityRating) ? opt.qualityRating : null,
        availability: typeof opt.availability === 'string' ? opt.availability : '',
        notes: typeof opt.notes === 'string' ? opt.notes : '',
      }));
      await setDoc(doc(db, 'wishlist', item.id), {
        id: item.id,
        name,
        description: item.description || '',
        priority,
        quantity,
        estimatedCost,
        currency: item.currency || '',
        purchaseOptions: cleanOptions,
        uid: user.uid,
        createdAt: Timestamp.fromDate(createdAt),
      });
      markSaved(`Saved ${item.name}`);
    } catch (err) {
      if (err instanceof Error && err.message === 'Wishlist item name is required.') {
        toast.error(err.message);
        return;
      }
      toast.error(`Could not save ${item.name || 'wishlist item'}`);
      handleFirestoreError(err, OperationType.WRITE, `wishlist/${item.id}`);
    }
  };

  const handleDeleteWishlist = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'wishlist', id));
      markSaved('Wishlist item removed');
    } catch (err) {
      toast.error('Could not remove wishlist item');
      handleFirestoreError(err, OperationType.DELETE, `wishlist/${id}`);
    }
  };

  const exportToCSV = () => {
    const headers = ['Timestamp', 'Free Chlorine (ppm)', 'Total Chlorine (ppm)', 'pH', 'Alkalinity (ppm)', 'Temp (°C)', 'Diff Pressure (kPa)', 'Calcium Hardness (ppm)', 'CYA (ppm)', 'Notes'];
    const csvNum = (v: number | null) => v == null ? '' : String(v);
    const rows = readings.map(r => [
      r.timestamp.toISOString(),
      csvNum(r.chlorine),
      csvNum(r.totalChlorine),
      csvNum(r.ph),
      csvNum(r.alkalinity),
      csvNum(r.temperature),
      csvNum(r.differentialPressure),
      csvNum(r.calciumHardness),
      csvNum(r.cyanuricAcid),
      r.notes || '',
    ]);

    const missingInventory = inventory
      .filter(item => item.quantity <= item.minThreshold)
      .map(item => `${item.name} (${item.quantity}${item.unit}, min ${item.minThreshold}${item.unit})`);
    const missingEquipment = equipment
      .filter(item => {
        if (!item.lastServiceDate || !item.serviceIntervalMonths) return false;
        const next = new Date(item.lastServiceDate);
        next.setMonth(next.getMonth() + item.serviceIntervalMonths);
        return new Date() >= next;
      })
      .map(item => item.name);

    const reportRows = reportEntries.map(entry => [
      entry.timestamp,
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      entry.summary
    ]);
    const templateRows = reportTemplate
      ? [[new Date().toISOString(), '', '', '', '', '', '', '', '', `Template: ${reportTemplate.replace(/\n+/g, ' ').trim()}`]]
      : [];
    const missingRows = [
      [new Date().toISOString(), '', '', '', '', '', '', '', '', `Missing Inventory: ${missingInventory.length ? missingInventory.join('; ') : 'None'}`],
      [new Date().toISOString(), '', '', '', '', '', '', '', '', `Missing Equipment Service: ${missingEquipment.length ? missingEquipment.join('; ') : 'None'}`]
    ];
    
    const csvContent = [headers, ...rows, ...templateRows, ...missingRows, ...reportRows].map(e => e.map(value => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `pool_report_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleAddToReport = (entry: { timestamp: string; summary: string }) => {
    setReportEntries(prev => [entry, ...prev].slice(0, 30));
  };

  const handleTemplateUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const content = typeof reader.result === 'string' ? reader.result : '';
      setReportTemplate(content.slice(0, 5000));
      input.value = '';
    };
    reader.onerror = () => {
      input.value = '';
    };
    reader.readAsText(file);
  };

  const closeReadingEditAndReturnToHistoryIfNeeded = () => {
    setEditingReading(null);
    setEditFocusField(undefined);
    if (returnToHistoryAfterEdit) {
      setIsHistoryOpen(true);
      setReturnToHistoryAfterEdit(false);
    }
  };

  const closeTabViews = () => {
    setIsHistoryOpen(false);
    setIsTasksOpen(false);
    setIsInventoryOpen(false);
    setIsMoreOpen(false);
    setTrendsView(null);
  };

  const activeTab: Tab = isMoreOpen ? 'more' : isHistoryOpen ? 'readings' : isTasksOpen ? 'tasks' : isInventoryOpen ? 'supplies' : 'home';

  const selectTab = (tab: Tab) => {
    const reopen = tab !== activeTab;
    closeTabViews();
    if (!reopen) return; // tapping the active tab closes it back to Home
    switch (tab) {
      case 'readings': setIsHistoryOpen(true); break;
      case 'tasks': setIsTasksOpen(true); break;
      case 'supplies': setIsInventoryOpen(true); break;
      case 'more': setIsMoreOpen(true); break;
      default: break;
    }
  };

  const openTrends = (focusMetric?: TrendMetricKey) => {
    closeTabViews();
    setTrendsView({ focusMetric });
  };

  const openAssistant = (mode: AssistantOpenMode) => setAssistantMode(mode);

  // Full-screen entry/edit forms and the printable report take the whole
  // viewport; the tab bar and assistant button get out of their way.
  const chromeHidden = isLogging || editingReading != null || isWeeklyReportOpen;

  if (!isAuthReady) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-accent"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-bg grid-bg flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full panel p-8 rounded-3xl text-center space-y-6"
        >
          <div className="w-20 h-20 bg-accent/10 rounded-full flex items-center justify-center mx-auto text-accent">
            <UserIcon size={40} />
          </div>
          <div className="space-y-2">
            <h1 className="wordmark text-2xl text-white">
              Pool<span className="text-accent">Status</span>
            </h1>
            <p className="text-ink-dim text-sm">Sign in to sync your pool data across devices securely.</p>
          </div>
          <button 
            onClick={signIn}
            className="w-full py-4 rounded-2xl bg-accent text-primary font-bold uppercase tracking-widest hover:brightness-110 transition-all flex items-center justify-center gap-3"
          >
            <LogIn size={20} />
            Sign in with Google
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg text-ink selection:bg-accent/30 selection:text-white">
      <OfflineIndicator isOnline={isOnline} lastSaved={lastSaved} />
      
      <main className="min-h-screen">
        <Dashboard
          readings={readings}
          readingsLoaded={readingsLoaded}
          tasks={tasks}
          schedule={schedule}
          inventory={inventory}
          equipment={equipment}
          protocol={protocol}
          protocolState={protocolState}
          onRequestProtocol={handleRequestProtocol}
          onExecuteProtocol={requestExecuteProtocol}
          onLogReading={(focusField) => {
            setHistoricLogTimestamp(null);
            setLogFocusField(focusField);
            setIsLogging(true);
          }}
          onViewHistory={() => selectTab('readings')}
          onOpenTrends={openTrends}
          onOpenTasks={() => selectTab('tasks')}
          onOpenEquipment={() => setIsEquipmentOpen(true)}
          onOpenInventory={() => selectTab('supplies')}
          onOpenWeeklyReport={() => setIsWeeklyReportOpen(true)}
          onOpenReminderSettings={() => setIsReminderSettingsOpen(true)}
          onOpenAssistant={openAssistant}
          onSyncPoolController={handleSyncPoolController}
          onProbePoolController={handleProbePoolController}
        />
      </main>

      {!chromeHidden && <TabBar active={activeTab} onSelect={selectTab} />}

      <MoreSheet
        isOpen={isMoreOpen}
        onClose={() => setIsMoreOpen(false)}
        onOpenEquipment={() => setIsEquipmentOpen(true)}
        onOpenWeeklyReport={() => setIsWeeklyReportOpen(true)}
        onOpenTrends={() => openTrends()}
        onOpenWishlist={() => setIsWishlistOpen(true)}
        onOpenWorkTracker={() => setIsWorkTrackerOpen(true)}
        onOpenGlossary={() => setIsGlossaryOpen(true)}
        onOpenCheatSheet={() => setIsCheatSheetOpen(true)}
        onOpenReminderSettings={() => setIsReminderSettingsOpen(true)}
        onOpenAgents={() => selectTab('readings')}
        onOpenControllerImport={() => setIsControllerImportOpen(true)}
        onTemplateUpload={handleTemplateUpload}
        onExport={exportToCSV}
        onPrint={() => window.print()}
        onSignOut={logout}
      />

      <AnimatePresence>
        {isWorkTrackerOpen && (
          <motion.div
            key="work-tracker"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="overlay z-[60] flex items-center justify-center p-4"
            onClick={() => setIsWorkTrackerOpen(false)}
          >
            <div ref={workTrackerRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Work time tracker" className="w-full max-w-md space-y-3" onClick={(e) => e.stopPropagation()}>
              <div className="flex justify-end">
                <button type="button" onClick={() => setIsWorkTrackerOpen(false)} aria-label="Close work tracker" className="icon-btn"><X size={16} /></button>
              </div>
              <WorkTracker
                sessions={workSessions}
                activeSession={activeSession}
                geoAutoStartEnabled={geoAutoStartEnabled}
                onStart={handleStartWorkSession}
                onStop={handleStopWorkSession}
                onToggleGeoAutoStart={setGeoAutoStartEnabled}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {user && (
        <ControllerImport
          isOpen={isControllerImportOpen}
          onClose={() => setIsControllerImportOpen(false)}
          uid={user.uid}
        />
      )}

      <ReminderSettings 
        isOpen={isReminderSettingsOpen}
        onClose={() => setIsReminderSettingsOpen(false)}
        schedule={schedule}
        onUpdateSchedule={handleUpdateSchedule}
      />

      <Inventory 
        isOpen={isInventoryOpen}
        onClose={() => setIsInventoryOpen(false)}
        items={inventory}
        onUpdateItem={handleUpdateInventory}
        onDeleteItem={handleDeleteInventory}
      />

      <Equipment
        isOpen={isEquipmentOpen}
        onClose={() => setIsEquipmentOpen(false)}
        items={equipment}
        onUpdateItem={handleUpdateEquipment}
        onDeleteItem={handleDeleteEquipment}
      />

      <Wishlist
        isOpen={isWishlistOpen}
        onClose={() => setIsWishlistOpen(false)}
        items={wishlist}
        onUpdateItem={handleUpdateWishlist}
        onDeleteItem={handleDeleteWishlist}
      />

      <AnimatePresence>
        {isTasksOpen && (
          <Tasks
            tasks={tasks}
            toggleTask={toggleTask}
            onAddTask={handleAddTask}
            onBack={() => setIsTasksOpen(false)}
          />
        )}

        {trendsView && (
          <TrendsView
            readings={readings}
            userId={user.uid}
            focusMetric={trendsView.focusMetric}
            onLogReading={() => {
              setLogFocusField(undefined);
              setIsLogging(true);
            }}
            onBack={() => setTrendsView(null)}
          />
        )}

        {isHistoryOpen && (
          <History
            hidden={isLogging}
            readings={readings}
            onBack={() => setIsHistoryOpen(false)}
            onDelete={handleDeleteReading}
            onEdit={(reading, focusField) => {
              setReturnToHistoryAfterEdit(true);
              setIsHistoryOpen(false);
              setEditFocusField(focusField);
              setEditingReading(reading);
            }}
            onAddHistoricReading={(timestamp) => {
              // The calendar stays mounted but hidden while the form is open,
              // so its month and selected day survive.
              historicReturnFocusRef.current =
                document.activeElement instanceof HTMLElement ? document.activeElement : null;
              setHistoricLogTimestamp(timestamp);
              setLogFocusField(undefined);
              setIsLogging(true);
            }}
          />
        )}

        {isLogging && (
          <ReadingForm
            focusField={logFocusField}
            onSave={handleSaveReading}
            onCancel={() => {
              if (historicLogTimestamp !== null) restoreHistoricFocus();
              setIsLogging(false);
              setHistoricLogTimestamp(null);
            }}
            initialTimestamp={historicLogTimestamp ?? undefined}
          />
        )}

        {editingReading && (
          <ReadingForm
            key={editingReading.id}
            initialReading={editingReading}
            focusField={editFocusField}
            onSave={async (updates) => {
              const updated = await handleUpdateReading(editingReading.id, editingReading, updates);
              if (!updated) return;
              closeReadingEditAndReturnToHistoryIfNeeded();
            }}
            onCancel={closeReadingEditAndReturnToHistoryIfNeeded}
          />
        )}
      </AnimatePresence>

      <CheatSheet 
        isOpen={isCheatSheetOpen}
        onClose={() => setIsCheatSheetOpen(false)}
      />

      <Glossary 
        isOpen={isGlossaryOpen}
        onClose={() => setIsGlossaryOpen(false)}
      />

      <WeeklyReport
        isOpen={isWeeklyReportOpen}
        onClose={() => setIsWeeklyReportOpen(false)}
        readings={readings}
        inventory={inventory}
        user={user}
      />

      <ProtocolConfirm
        open={protocolConfirmOpen}
        steps={protocol?.checklist.map((step) => step.title) ?? []}
        suggestedProducts={suggestedProductsFromStock(inventory)}
        onCancel={() => settleProtocolConfirm(false)}
        onConfirm={(products) => settleProtocolConfirm(true, products)}
      />

      <GeminiAssistant
        latestReading={latestForAi}
        history={readings}
        mode={assistantMode}
        onModeChange={setAssistantMode}
        protocol={protocol}
        protocolState={protocolState}
        onRequestProtocol={handleRequestProtocol}
        onExecuteProtocol={requestExecuteProtocol}
        onAddToReport={handleAddToReport}
        hidden={chromeHidden}
      />
    </div>
  );
}
