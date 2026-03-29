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
