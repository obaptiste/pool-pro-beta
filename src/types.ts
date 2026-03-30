export type Status = 'good' | 'warning' | 'critical';
export type Priority = 'low' | 'medium' | 'high' | 'critical';
export type TaskFrequency = 'daily' | 'weekly' | 'monthly' | 'once';

export interface Reading {
  id: string;
  timestamp: Date;
  chlorine: number;
  ph: number;
  alkalinity: number;
  temperature: number;
  differentialPressure: number;
  calciumHardness: number;
  cyanuricAcid: number;
  notes?: string;
  uid: string;
}

export interface MaintenanceTask {
  id: string;
  title: string;
  completed: boolean;
  priority: Priority;
  frequency: TaskFrequency;
  isAI?: boolean;
  uid: string;
  createdAt: Date;
}

export const DEFAULT_POOL_TASKS: Omit<MaintenanceTask, 'id' | 'uid' | 'createdAt'>[] = [
  { title: 'Empty skimmer baskets', completed: false, priority: 'medium', frequency: 'daily', isAI: false },
  { title: 'Check pump strainer', completed: false, priority: 'medium', frequency: 'daily', isAI: false },
  { title: 'Inspect water level', completed: false, priority: 'low', frequency: 'daily', isAI: false },
  { title: 'Check pump pressure', completed: false, priority: 'medium', frequency: 'daily', isAI: false },
  { title: 'Test chemical levels', completed: false, priority: 'high', frequency: 'weekly', isAI: false },
  { title: 'Vacuum pool', completed: false, priority: 'medium', frequency: 'weekly', isAI: false },
  { title: 'Brush walls/floor', completed: false, priority: 'low', frequency: 'weekly', isAI: false },
  { title: 'Clean skimmer baskets', completed: false, priority: 'medium', frequency: 'weekly', isAI: false },
  { title: 'Backwash filter', completed: false, priority: 'high', frequency: 'monthly', isAI: false },
  { title: 'Inspect equipment for leaks', completed: false, priority: 'high', frequency: 'monthly', isAI: false },
  { title: 'Check pump/filter seals', completed: false, priority: 'medium', frequency: 'monthly', isAI: false },
  { title: 'Test GFCI', completed: false, priority: 'critical', frequency: 'monthly', isAI: false },
  { title: 'Purchase Floating Thermometer', completed: false, priority: 'medium', frequency: 'once', isAI: false },
  { title: 'Purchase Digital pH Tester', completed: false, priority: 'high', frequency: 'once', isAI: false },
];

export const DEFAULT_INVENTORY: Omit<InventoryItem, 'id' | 'uid'>[] = [
  { name: 'Chlorine Granules', quantity: 10, unit: 'kg', minThreshold: 2 },
  { name: 'Soda Ash', quantity: 5, unit: 'kg', minThreshold: 1 },
  { name: 'Muriatic Acid', quantity: 5, unit: 'L', minThreshold: 1 },
  { name: 'Sodium Bicarbonate', quantity: 10, unit: 'kg', minThreshold: 2 },
  { name: 'Calcium Chloride', quantity: 5, unit: 'kg', minThreshold: 1 },
  { name: 'Cyanuric Acid', quantity: 2, unit: 'kg', minThreshold: 0.5 },
];

export const DEFAULT_EQUIPMENT: Omit<EquipmentItem, 'id' | 'uid'>[] = [
  { name: 'Pool Vacuum', installDate: new Date(), serviceIntervalMonths: 12 },
  { name: 'Sand Filter', installDate: new Date(), serviceIntervalMonths: 24 },
  { name: 'Main Pump', installDate: new Date(), serviceIntervalMonths: 12 },
];

export interface InventoryItem {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  minThreshold: number;
  uid: string;
}

export interface EquipmentItem {
  id: string;
  name: string;
  installDate: Date;
  lastServiceDate?: Date;
  serviceIntervalMonths?: number;
  uid: string;
}

export type Frequency = 'daily' | 'weekly' | 'biweekly' | 'monthly';

export interface MaintenanceSchedule {
  uid: string;
  testFrequency: Frequency;
  lastTestDate: Date | null;
  nextTestDate: Date | null;
  remindersEnabled: boolean;
}

export interface Ranges {
  chlorine: { min: number; max: number; unit: string };
  ph: { min: number; max: number; unit: string };
  alkalinity: { min: number; max: number; unit: string };
  temperature: { min: number; max: number; unit: string };
  differentialPressure: { min: number; max: number; unit: string };
  calciumHardness: { min: number; max: number; unit: string };
  cyanuricAcid: { min: number; max: number; unit: string };
}

export const DEFAULT_RANGES: Ranges = {
  chlorine: { min: 1, max: 3, unit: 'ppm' },
  ph: { min: 7.2, max: 7.8, unit: 'pH' },
  alkalinity: { min: 80, max: 120, unit: 'ppm' },
  temperature: { min: 24, max: 30, unit: '°C' },
  differentialPressure: { min: 55, max: 140, unit: 'kPa' },
  calciumHardness: { min: 200, max: 400, unit: 'ppm' },
  cyanuricAcid: { min: 30, max: 50, unit: 'ppm' },
};
