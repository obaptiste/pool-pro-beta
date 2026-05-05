import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import Dashboard from './components/Dashboard';
import ReadingForm from './components/ReadingForm';
import CheatSheet from './components/CheatSheet';
import OfflineIndicator from './components/OfflineIndicator';
import GeminiAssistant from './components/GeminiAssistant';
import History from './components/History';
import Glossary from './components/Glossary';
import ReminderSettings from './components/ReminderSettings';
import Inventory from './components/Inventory';
import Equipment from './components/Equipment';
import Wishlist from './components/Wishlist';
import WeeklyReport from './components/WeeklyReport';
import WorkTracker from './components/WorkTracker';
import { Reading, MaintenanceTask, MaintenanceSchedule, Frequency, InventoryItem, EquipmentItem, WishlistItem, WorkSession } from './types';
import { auth, db, signIn, logout, handleFirestoreError, OperationType } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { collection, query, where, onSnapshot, doc, setDoc, updateDoc, deleteDoc, Timestamp, orderBy, getDoc, addDoc } from 'firebase/firestore';
import { LogIn, LogOut, User as UserIcon, Package, Wrench, FileText, ListChecks } from 'lucide-react';
import { DEFAULT_POOL_TASKS, DEFAULT_INVENTORY, DEFAULT_EQUIPMENT } from './types';

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
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isCheatSheetOpen, setIsCheatSheetOpen] = useState(false);
  const [isGlossaryOpen, setIsGlossaryOpen] = useState(false);
  const [isReminderSettingsOpen, setIsReminderSettingsOpen] = useState(false);
  const [isInventoryOpen, setIsInventoryOpen] = useState(false);
  const [isEquipmentOpen, setIsEquipmentOpen] = useState(false);
  const [isWeeklyReportOpen, setIsWeeklyReportOpen] = useState(false);
  const [isWishlistOpen, setIsWishlistOpen] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [lastSaved, setLastSaved] = useState<Date | undefined>();
  const [reportEntries, setReportEntries] = useState<{ timestamp: string; summary: string }[]>([]);
  const [reportTemplate, setReportTemplate] = useState<string>('');

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
    if (!user) {
      setReadings([]);
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
        timestamp: (doc.data().timestamp as Timestamp).toDate()
      } as Reading)));
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'readings'));

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
      setWorkSessions(snapshot.docs.map((sessionDoc) => ({
        ...sessionDoc.data(),
        id: sessionDoc.id,
        startTime: (sessionDoc.data().startTime as Timestamp).toDate(),
        endTime: sessionDoc.data().endTime ? (sessionDoc.data().endTime as Timestamp).toDate() : null,
      } as WorkSession)));
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
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE);
    }
  };

  const handleStopWorkSession = async () => {
    if (!activeSession) return;

    try {
      await updateDoc(doc(db, 'workSessions', activeSession.id), {
        endTime: Timestamp.fromDate(new Date())
      });
    } catch (err) {
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
      if (meters < 120) {
        void handleStartWorkSession('geo');
      }
    });
    return () => navigator.geolocation.clearWatch(watchId);
  }, [geoAutoStartEnabled, user, activeSession]);

  const handleSaveReading = async (newReading: Omit<Reading, 'id' | 'timestamp' | 'uid'>) => {
    if (!user) return;
    const now = new Date();
    const id = Date.now().toString();
    const reading: Reading = {
      ...newReading,
      id,
      timestamp: now,
      uid: user.uid
    };

    try {
      await setDoc(doc(db, 'readings', id), {
        ...reading,
        timestamp: Timestamp.fromDate(now)
      });
      
      // Update schedule
      const daysToAdd = {
        daily: 1,
        weekly: 7,
        biweekly: 14,
        monthly: 30,
      }[schedule.testFrequency];

      const nextTest = new Date(now);
      nextTest.setDate(nextTest.getDate() + daysToAdd);

      await setDoc(doc(db, 'schedules', user.uid), {
        ...schedule,
        uid: user.uid,
        lastTestDate: Timestamp.fromDate(now),
        nextTestDate: Timestamp.fromDate(nextTest),
      }, { merge: true });

      setIsLogging(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `readings/${id}`);
    }
  };

  const handleDeleteReading = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'readings', id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `readings/${id}`);
    }
  };

  const toggleTask = async (id: string) => {
    const task = tasks.find(t => t.id === id);
    if (!task) return;
    try {
      await updateDoc(doc(db, 'tasks', id), { completed: !task.completed });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `tasks/${id}`);
    }
  };

  const handleExecuteProtocol = async (newTasks: MaintenanceTask[]) => {
    if (!user) return;
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
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'tasks');
    }
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
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `schedules/${user.uid}`);
    }
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
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `tasks`);
    }
  };

  const handleUpdateInventory = async (item: InventoryItem) => {
    if (!user) return;
    try {
      await setDoc(doc(db, 'inventory', item.id), { ...item, uid: user.uid });
    } catch (err) {
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
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `equipment/${item.id}`);
    }
  };

  const handleDeleteInventory = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'inventory', id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `inventory/${id}`);
    }
  };

  const handleDeleteEquipment = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'equipment', id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `equipment/${id}`);
    }
  };

  const handleUpdateWishlist = async (item: WishlistItem) => {
    if (!user) return;
    try {
      const cleanOptions = (item.purchaseOptions || []).map(opt => ({
        id: opt.id,
        vendor: opt.vendor || '',
        url: opt.url || '',
        price: opt.price ?? null,
        currency: opt.currency || '',
        qualityRating: opt.qualityRating ?? null,
        availability: opt.availability || '',
        notes: opt.notes || '',
      }));
      await setDoc(doc(db, 'wishlist', item.id), {
        id: item.id,
        name: item.name,
        description: item.description || '',
        priority: item.priority,
        quantity: item.quantity,
        estimatedCost: item.estimatedCost ?? null,
        currency: item.currency || '',
        purchaseOptions: cleanOptions,
        uid: user.uid,
        createdAt: Timestamp.fromDate(item.createdAt || new Date()),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `wishlist/${item.id}`);
    }
  };

  const handleDeleteWishlist = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'wishlist', id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `wishlist/${id}`);
    }
  };

  const exportToCSV = () => {
    const headers = ['Timestamp', 'Chlorine (ppm)', 'pH', 'Alkalinity (ppm)', 'Temp (°C)', 'Diff Pressure (kPa)', 'Calcium Hardness (ppm)', 'CYA (ppm)', 'Notes'];
    const rows = readings.map(r => [
      r.timestamp.toISOString(),
      r.chlorine,
      r.ph,
      r.alkalinity,
      r.temperature,
      r.differentialPressure,
      r.calciumHardness,
      r.cyanuricAcid,
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
      entry.summary
    ]);
    const templateRows = reportTemplate
      ? [[new Date().toISOString(), '', '', '', '', '', '', '', `Template: ${reportTemplate.replace(/\n+/g, ' ').trim()}`]]
      : [];
    const missingRows = [
      [new Date().toISOString(), '', '', '', '', '', '', '', `Missing Inventory: ${missingInventory.length ? missingInventory.join('; ') : 'None'}`],
      [new Date().toISOString(), '', '', '', '', '', '', '', `Missing Equipment Service: ${missingEquipment.length ? missingEquipment.join('; ') : 'None'}`]
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
      
      <nav className="fixed top-0 left-0 right-0 z-50 bg-bg/80 backdrop-blur-md border-b border-border-dim px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="wordmark text-lg text-white">
            Pool<span className="text-accent">Status</span>
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <label className="px-3 py-1.5 rounded-lg bg-surface border border-border-dim text-ink-dim hover:text-white transition-all text-[10px] font-bold uppercase tracking-widest cursor-pointer">
            Report Template
            <input type="file" accept=".txt,.md,.csv" onChange={handleTemplateUpload} className="hidden" />
          </label>
          <button
            onClick={() => setIsInventoryOpen(true)}
            className="p-2 rounded-lg bg-surface border border-border-dim text-ink-muted hover:text-white transition-colors"
            title="Inventory"
          >
            <Package size={18} />
          </button>
          <button
            onClick={() => setIsEquipmentOpen(true)}
            className="p-2 rounded-lg bg-surface border border-border-dim text-ink-muted hover:text-white transition-colors"
            title="Equipment"
          >
            <Wrench size={18} />
          </button>
          <button
            onClick={() => setIsWishlistOpen(true)}
            className="p-2 rounded-lg bg-surface border border-border-dim text-ink-muted hover:text-white transition-colors"
            title="Equipment Wishlist"
          >
            <ListChecks size={18} />
          </button>
          <button
            onClick={() => setIsWeeklyReportOpen(true)}
            className="p-2 rounded-lg bg-surface border border-border-dim text-ink-muted hover:text-accent transition-colors"
            title="Weekly Report"
          >
            <FileText size={18} />
          </button>
          <div className="h-8 w-[1px] bg-border-dim mx-1" />
          <button 
            onClick={logout}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface border border-border-dim text-ink-dim hover:text-white transition-all text-[10px] font-bold uppercase tracking-widest"
          >
            <LogOut size={14} />
            Sign Out
          </button>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-4 pt-24 pb-24 md:pt-28 grid-bg space-y-4">
        <WorkTracker
          sessions={workSessions}
          activeSession={activeSession}
          geoAutoStartEnabled={geoAutoStartEnabled}
          onStart={handleStartWorkSession}
          onStop={handleStopWorkSession}
          onToggleGeoAutoStart={setGeoAutoStartEnabled}
        />
        <Dashboard 
          readings={readings} 
          tasks={tasks}
          schedule={schedule}
          inventory={inventory}
          equipment={equipment}
          onLogReading={() => setIsLogging(true)}
          onOpenCheatSheet={() => setIsCheatSheetOpen(true)}
          onOpenGlossary={() => setIsGlossaryOpen(true)}
          onViewHistory={() => setIsHistoryOpen(true)}
          onOpenReminderSettings={() => setIsReminderSettingsOpen(true)}
          onExport={exportToCSV}
          onPrint={() => window.print()}
          toggleTask={toggleTask}
          onAddTask={handleAddTask}
        />
      </main>

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
        {isLogging && (
          <ReadingForm 
            onSave={handleSaveReading}
            onCancel={() => setIsLogging(false)}
          />
        )}
        
        {isHistoryOpen && (
          <History 
            readings={readings}
            onBack={() => setIsHistoryOpen(false)}
            onDelete={handleDeleteReading}
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

      <GeminiAssistant
        latestReading={readings[0]}
        history={readings}
        onExecuteProtocol={handleExecuteProtocol}
        onAddToReport={handleAddToReport}
      />
    </div>
  );
}
