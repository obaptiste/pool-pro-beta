import assert from 'node:assert/strict';
import test from 'node:test';
import { isProtocolConfirmReady } from './protocolConfirm';

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
