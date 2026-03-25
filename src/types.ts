export type Status = 'good' | 'warning' | 'critical';

export interface Reading {
  id: string;
  timestamp: Date;
  chlorine: number;
  ph: number;
  alkalinity: number;
  temperature: number;
  differentialPressure: number;
  notes?: string;
}

export interface MaintenanceTask {
  id: string;
  title: string;
  completed: boolean;
  frequency?: 'daily' | 'monthly';
}

export interface InventoryItem {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  lowThreshold: number;
  category: 'chemical' | 'equipment' | 'supplies';
}

export interface Equipment {
  id: string;
  name: string;
  type: string;
  status: 'operational' | 'needs-attention' | 'offline';
  lastChecked?: string;
  notes?: string;
}

export interface Ranges {
  chlorine: { min: number; max: number; unit: string };
  ph: { min: number; max: number; unit: string };
  alkalinity: { min: number; max: number; unit: string };
  temperature: { min: number; max: number; unit: string };
  differentialPressure: { min: number; max: number; unit: string };
}

export const DEFAULT_RANGES: Ranges = {
  chlorine: { min: 1, max: 3, unit: 'ppm' },
  ph: { min: 7.2, max: 7.8, unit: 'pH' },
  alkalinity: { min: 80, max: 120, unit: 'ppm' },
  temperature: { min: 24, max: 30, unit: '°C' },
  differentialPressure: { min: 8, max: 20, unit: 'PSI' },
};
