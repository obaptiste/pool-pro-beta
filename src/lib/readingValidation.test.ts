import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getCombinedChlorineWarning, combinedChlorineOf, getCombinedChlorineStatus } from './readingValidation';

test('no warning unless both free and total chlorine are measured', () => {
  assert.equal(getCombinedChlorineWarning(null, 3), null);
  assert.equal(getCombinedChlorineWarning(1, null), null);
  assert.equal(getCombinedChlorineWarning(1, 1.3), null);
  assert.equal(getCombinedChlorineWarning(1.1, 1.6), null); // 0.5 exactly, not float noise above it
});

test('flags high combined chlorine even when each value is in range', () => {
  // FC 1 and TC 3 are each "nominal" against their own ranges, but 2 ppm combined.
  const warning = getCombinedChlorineWarning(1, 3);
  assert.equal(warning?.level, 'warning');
  assert.match(warning?.message ?? '', /2\.0 ppm/);
});

test('flags mildly elevated combined chlorine as elevated, not warning', () => {
  assert.equal(getCombinedChlorineWarning(1.5, 2.3)?.level, 'elevated');
});

test('flags total chlorine below free chlorine as inconsistent', () => {
  assert.match(getCombinedChlorineWarning(2, 1.5)?.message ?? '', /below free/);
});

test('combined chlorine derivation and status', () => {
  assert.equal(combinedChlorineOf(1, 1.4), 0.4);
  assert.equal(combinedChlorineOf(2, 1.5), 0); // clamped, never negative
  assert.equal(combinedChlorineOf(null, 2), null);
  assert.equal(getCombinedChlorineStatus(0.4), 'good');
  assert.equal(getCombinedChlorineStatus(0.8), 'warning');
  assert.equal(getCombinedChlorineStatus(1.2), 'critical');
});
