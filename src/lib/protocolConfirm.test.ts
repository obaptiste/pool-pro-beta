import assert from 'node:assert/strict';
import test from 'node:test';
import { formatStockForPrompt, isProtocolConfirmReady, suggestedProductsFromStock } from './protocolConfirm';

const complete = { unoccupied: true, circulating: true, products: '10% liquid chlorine' };

test('ready only when occupancy, circulation, and products are all confirmed', () => {
  assert.equal(isProtocolConfirmReady(complete), true);
});

test('not ready when the pool may be occupied or circulation is not running', () => {
  assert.equal(isProtocolConfirmReady({ ...complete, unoccupied: false }), false);
  assert.equal(isProtocolConfirmReady({ ...complete, circulating: false }), false);
});

test('not ready without a real product description', () => {
  assert.equal(isProtocolConfirmReady({ ...complete, products: '' }), false);
  assert.equal(isProtocolConfirmReady({ ...complete, products: '   ' }), false);
  assert.equal(isProtocolConfirmReady({ ...complete, products: 'ab' }), false);
});

test('stock list for the prompt shows each strength, or that it is not recorded', () => {
  assert.equal(formatStockForPrompt([]), 'none recorded');
  assert.equal(
    formatStockForPrompt([{ name: 'Muriatic Acid', concentrationPct: 31 }, { name: 'Soda Ash' }]),
    '- Muriatic Acid, 31% strength\n- Soda Ash, strength not recorded',
  );
});

test('confirmation prefill lists only stocked products with a recorded strength', () => {
  assert.equal(
    suggestedProductsFromStock([
      { name: 'Chlorine Granules', concentrationPct: 10 },
      { name: 'Soda Ash' },
      { name: 'Muriatic Acid', concentrationPct: 31 },
    ]),
    '10% Chlorine Granules, 31% Muriatic Acid',
  );
  assert.equal(suggestedProductsFromStock([{ name: 'Soda Ash' }]), '');
});
