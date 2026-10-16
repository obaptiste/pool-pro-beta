import assert from 'node:assert/strict';
import test from 'node:test';
import { controllerLogDocId, isDoseWindow, summariseSafetyWarnings, parseCell, parseHannaCsv, parseLocalDateTime, splitCsvLine, HannaCsvError } from './hannaCsv';

// Trimmed from a real BL122 export, trailing tabs included.
const HEADER = [
  'General Information\t',
  'Location, Joy Lane\t',
  'Device ID, BL122_7AC443\t',
  'Device Model No., BL122 (V1)\t',
  'Start Date, 2026-07-16 10:09:06\t',
  'End Date, 2026-10-16 10:09:06\t',
  '\t',
  'Controller Information\t',
  'Model, BL122\t',
  'Serial No., C0437033\t',
  '\t',
  'pH Calibration\t',
  'Date, Calibration Point 1, Calibration Point 2, Slope (%), Offset (mV)\t',
  '2026-09-16 14:01:10,"-- pH, -- mV, -- °C","8.00 pH, -- mV, -- °C",96.0,47.9\t',
  '\t',
  '#Rec,Start Date & Time,End Date & Time,Min pH,Max pH,Min ORP(mV),Max ORP(mV),Min Temp (°C),Max Temp (°C),Min Acid/Base (mL),Max Acid/Base (mL),Min Cl₂ (mL),Max Cl₂ (mL)\t',
];
const ROWS = [
  '1,2026-10-14 13:41:07,2026-10-14 13:56:11,--,--,--,--,--,--,0.00,70.48,0,0\t',
  '2,2026-10-14 14:09:17,2026-10-14 14:56:15,7.45,7.52,715,719,29.8,31.4,0.00,0.00,0,0\t',
  '3,2026-10-14 15:11:15,2026-10-14 15:56:17,--,--,--,--,--,--,--,--,--,--\t',
  '7,2026-10-14 19:10:04,2026-10-14 19:57:06,7.18,7.49,697,709,33.4,38.1,0.00,297.69,0,50\t',
];
const csv = (rows = ROWS, header = HEADER, eol = '\n') => [...header, ...rows].join(eol);

test('reads device metadata, the requested period, and the data rows', () => {
  const out = parseHannaCsv(csv());
  assert.equal(out.deviceId, 'BL122_7AC443');
  assert.equal(out.model, 'BL122 (V1)');
  assert.equal(out.location, 'Joy Lane');
  assert.equal(out.requestedStart, '2026-07-16 10:09:06');
  assert.equal(out.requestedEnd, '2026-10-16 10:09:06');
  assert.deepEqual(out.windows.map((w) => w.rec), [1, 2, 7]);
});

test('keeps min/max and dose values exactly as reported', () => {
  const w = parseHannaCsv(csv()).windows.find((x) => x.rec === 7)!;
  assert.equal(w.startLocal, '2026-10-14 19:10:04');
  assert.equal(w.endLocal, '2026-10-14 19:57:06');
  assert.deepEqual(
    [w.phMin, w.phMax, w.orpMinMv, w.orpMaxMv, w.temperatureMinC, w.temperatureMaxC],
    [7.18, 7.49, 697, 709, 33.4, 38.1],
  );
  assert.deepEqual([w.acidBaseMinMl, w.acidBaseMaxMl, w.chlorineMinMl, w.chlorineMaxMl], [0, 297.69, 0, 50]);
  assert.equal(w.start.getHours(), 19);
  assert.equal(w.start.getMinutes(), 10);
});

test('"--" becomes null, never 0', () => {
  const w = parseHannaCsv(csv()).windows.find((x) => x.rec === 1)!;
  assert.equal(w.phMin, null);
  assert.equal(w.orpMaxMv, null);
  assert.equal(w.temperatureMaxC, null);
  assert.equal(w.acidBaseMaxMl, 70.48); // dose-only window is kept
});

test('skips and counts a row with no probe values and no dose', () => {
  const out = parseHannaCsv(csv());
  assert.equal(out.emptyRows, 1);
  assert.ok(!out.windows.some((w) => w.rec === 3));
});

test('treats blank and non-numeric cells as not measured', () => {
  assert.equal(parseCell(''), null);
  assert.equal(parseCell('   '), null);
  assert.equal(parseCell('--'), null);
  assert.equal(parseCell('Err'), null);
  assert.equal(parseCell('1e3'), null);
  assert.equal(parseCell(' 7.5 '), 7.5);
  assert.equal(parseCell('-14'), -14);
  const out = parseHannaCsv(csv(['5,2026-10-14 17:11:26,2026-10-14 17:56:27,,7.53,706,710,29.7,31.5,0.00,0.00,0,0']));
  assert.equal(out.windows[0].phMin, null);
  assert.equal(out.windows[0].phMax, 7.53);
});

test('keeps abnormal but possible pH and ORP', () => {
  const out = parseHannaCsv(csv(['9,2026-10-14 21:12:07,2026-10-14 21:57:07,5.1,9.4,233,960,29,30,0,0,0,0']));
  const w = out.windows[0];
  assert.deepEqual([w.phMin, w.phMax, w.orpMinMv, w.orpMaxMv], [5.1, 9.4, 233, 960]);
});

test('drops a physically impossible temperature sentinel', () => {
  const w = parseHannaCsv(csv(['9,2026-10-14 21:12:07,2026-10-14 21:57:07,7.4,7.5,700,710,-999,30,0,0,0,0'])).windows[0];
  assert.equal(w.temperatureMinC, null);
  assert.equal(w.temperatureMaxC, 30);
});

test('handles CRLF line endings and a byte-order mark', () => {
  const out = parseHannaCsv('﻿' + csv(ROWS, HEADER, '\r\n'));
  assert.equal(out.deviceId, 'BL122_7AC443');
  assert.equal(out.windows.length, 3);
});

test('reports rows whose timestamps are not real date-times', () => {
  const out = parseHannaCsv(csv([
    '4,2026-02-30 10:00:00,2026-02-30 10:45:00,7.5,7.52,711,714,29.7,29.8,0,0,0,0',
    '5,14/10/2026 17:11,2026-10-14 17:56:27,7.5,7.53,706,710,29.7,31.5,0,0,0,0',
    '6,2026-10-14 18:57:52,2026-10-14 18:11:27,7.51,7.54,704,705,31.5,31.9,0,0,0,0',
    ...ROWS,
  ]));
  assert.deepEqual(out.invalidRows, [4, 5, 6]);
  assert.equal(out.windows.length, 3);
});

test('finds columns by name, not position', () => {
  const header = [...HEADER.slice(0, -1), 'Start Date & Time,#Rec,End Date & Time,Max pH,Min pH,Min ORP(mV),Max ORP(mV),Min Temp (°C),Max Temp (°C),Min Acid/Base (mL),Max Acid/Base (mL),Min Cl2 (mL),Max Cl2 (mL)'];
  const w = parseHannaCsv(csv(['2026-10-14 14:09:17,2,2026-10-14 14:56:15,7.52,7.45,715,719,29.8,31.4,0,0,0,0'], header)).windows[0];
  assert.equal(w.rec, 2);
  assert.equal(w.phMin, 7.45);
  assert.equal(w.phMax, 7.52);
});

test('throws a clear error for a missing column, °F, an empty file, or a non-Hanna file', () => {
  const noCl = [...HEADER.slice(0, -1), '#Rec,Start Date & Time,End Date & Time,Min pH,Max pH,Min ORP(mV),Max ORP(mV),Min Temp (°C),Max Temp (°C),Min Acid/Base (mL),Max Acid/Base (mL)'];
  assert.throws(() => parseHannaCsv(csv(ROWS, noCl)), (e) => e instanceof HannaCsvError && /min cl2 \(ml\)/.test(e.message));
  const fahrenheit = HEADER.map((l) => l.replace(/°C\)/g, '°F)'));
  assert.throws(() => parseHannaCsv(csv(ROWS, fahrenheit)), /°F/);
  assert.throws(() => parseHannaCsv(''), /empty/);
  assert.throws(() => parseHannaCsv('date,chlorine\n2026-10-14,1.5'), /#Rec/);
  const noDevice = HEADER.filter((l) => !l.startsWith('Device ID'));
  assert.throws(() => parseHannaCsv(csv(ROWS, noDevice)), /Device ID/);
});

test('splitCsvLine keeps quoted commas inside one cell', () => {
  assert.deepEqual(splitCsvLine('a,"b, c",d'), ['a', 'b, c', 'd']);
  assert.deepEqual(splitCsvLine('"say ""hi""",2'), ['say "hi"', '2']);
});

test('parseLocalDateTime rejects impossible dates and other formats', () => {
  assert.ok(parseLocalDateTime('2026-10-14 13:41:07'));
  assert.equal(parseLocalDateTime('2026-02-30 10:00:00'), null);
  assert.equal(parseLocalDateTime('2026-10-14T13:41:07'), null);
  assert.equal(parseLocalDateTime('2026-10-14'), null);
});

test('controllerLogDocId is deterministic, uid-prefixed, and path-safe', () => {
  assert.equal(controllerLogDocId('uid1', 'BL122_7AC443', '2026-10-14 19:10:04'), 'uid1_BL122_7AC443_20261014T191004');
  assert.equal(controllerLogDocId('uid1', 'a/b c', '2026-10-14 19:10:04'), 'uid1_a-b-c_20261014T191004');
});

test('isDoseWindow flags windows where either pump ran', () => {
  const ws = parseHannaCsv(csv()).windows;
  assert.deepEqual(ws.filter(isDoseWindow).map((w) => w.rec), [1, 7]);
});

test('summariseSafetyWarnings reports the most extreme low/high pH and ORP windows', () => {
  const ws = parseHannaCsv(csv([
    '2,2026-10-14 14:09:17,2026-10-14 14:56:15,7.45,7.52,715,719,29.8,31.4,0,0,0,0',
    '8,2026-10-14 20:12:06,2026-10-14 20:57:06,6.9,7.4,300,700,29,30,0,0,0,0',
    '9,2026-10-14 21:12:07,2026-10-14 21:57:07,6.5,7.4,233,700,29,30,0,0,0,0',
    '10,2026-10-14 22:12:07,2026-10-14 22:57:08,7.4,7.5,700,820,29,30,0,0,0,0',
  ])).windows;
  const out = summariseSafetyWarnings(ws);
  assert.equal(out.affectedWindows, 3);
  assert.deepEqual(out.worst.map((x) => [x.field, x.end, x.value, x.window.rec]), [
    ['ph', 'min', 6.5, 9],
    ['sanitisationMv', 'min', 233, 9],
    ['sanitisationMv', 'max', 820, 10],
  ]);
  assert.match(out.worst[0].message, /Very low pH/);
  assert.match(out.worst[2].message, /Verify before swimming/);
});

test('summariseSafetyWarnings flags a pH just under the 7.2 target from the real export', () => {
  const out = summariseSafetyWarnings(parseHannaCsv(csv()).windows);
  assert.equal(out.affectedWindows, 1);
  assert.deepEqual(out.worst.map((x) => [x.field, x.end, x.value, x.window.rec]), [['ph', 'min', 7.18, 7]]);
  assert.match(out.worst[0].message, /Below the 7.2/);
});

test('summariseSafetyWarnings is empty when pH and ORP are in range', () => {
  const ws = parseHannaCsv(csv(['2,2026-10-14 14:09:17,2026-10-14 14:56:15,7.45,7.52,715,719,29.8,31.4,0,0,0,0'])).windows;
  assert.deepEqual(summariseSafetyWarnings(ws), { affectedWindows: 0, worst: [] });
});
