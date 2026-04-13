import { Reading } from '../types';

export function calculateLSI(reading: Reading): number {
  const getTF = (temp: number) => {
    if (temp < 0) return 0;
    if (temp < 10) return 0.3;
    if (temp < 15) return 0.4;
    if (temp < 20) return 0.5;
    if (temp < 25) return 0.6;
    if (temp < 30) return 0.7;
    if (temp < 35) return 0.8;
    return 0.9;
  };

  const getCF = (ch: number) => {
    if (ch < 50) return 1.3;
    if (ch < 100) return 1.6;
    if (ch < 150) return 1.8;
    if (ch < 200) return 1.9;
    if (ch < 250) return 2.0;
    if (ch < 300) return 2.1;
    if (ch < 400) return 2.2;
    if (ch < 500) return 2.3;
    return 2.4;
  };

  const getAF = (alk: number) => {
    if (alk < 50) return 1.7;
    if (alk < 100) return 2.0;
    if (alk < 150) return 2.2;
    if (alk < 200) return 2.3;
    if (alk < 300) return 2.5;
    return 2.6;
  };

  const lsi =
    (Number(reading.ph) || 0) +
    getTF(Number(reading.temperature) || 0) +
    getCF(Number(reading.calciumHardness) || 0) +
    getAF(Number(reading.alkalinity) || 0) -
    12.1;
  return parseFloat(lsi.toFixed(2));
}
