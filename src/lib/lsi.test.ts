import assert from 'node:assert/strict';
import test from 'node:test';
import { getLsiStatus, getLsiLabel, getLsiDisplayLabel } from './lsi';

test('getLsiStatus uses the ±0.1/±0.3 thresholds shared by Dashboard, WeeklyReport, and the MCP server', () => {
  assert.equal(getLsiStatus(-0.31), 'critical');
  assert.equal(getLsiStatus(-0.3), 'warning');
  assert.equal(getLsiStatus(-0.11), 'warning');
  assert.equal(getLsiStatus(-0.1), 'good');
  assert.equal(getLsiStatus(0), 'good');
  assert.equal(getLsiStatus(0.1), 'good');
  assert.equal(getLsiStatus(0.11), 'warning');
  assert.equal(getLsiStatus(0.3), 'warning');
  assert.equal(getLsiStatus(0.31), 'critical');
});

test('getLsiLabel has a "drifting" case for the warning band, not just corrosive/scale-forming/balanced', () => {
  // The bug this closes: the label used to have no middle tier at all, so a
  // value getLsiStatus already calls 'warning' (0.1 < |lsi| <= 0.3) would be
  // labeled "balanced" -- text flatly contradicting its own severity.
  assert.equal(getLsiLabel(-0.31), 'corrosive');
  assert.equal(getLsiLabel(-0.2), 'drifting');
  assert.equal(getLsiLabel(0), 'balanced');
  assert.equal(getLsiLabel(0.2), 'drifting');
  assert.equal(getLsiLabel(0.31), 'scale-forming');
});

test('getLsiDisplayLabel is getLsiLabel\'s capitalized, human-facing form', () => {
  assert.equal(getLsiDisplayLabel(-0.31), 'Corrosive');
  assert.equal(getLsiDisplayLabel(-0.2), 'Drifting');
  assert.equal(getLsiDisplayLabel(0), 'Balanced');
  assert.equal(getLsiDisplayLabel(0.2), 'Drifting');
  assert.equal(getLsiDisplayLabel(0.31), 'Scale Forming');
});
