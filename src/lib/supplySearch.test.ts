import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSupplySearchUrl, getSupplySearchLocation } from './supplySearch';

test('builds a general Google Maps pool-supply search without a location', () => {
  const url = new URL(buildSupplySearchUrl());
  assert.equal(url.origin, 'https://www.google.com');
  assert.equal(url.pathname, '/maps/search/');
  assert.equal(url.searchParams.get('api'), '1');
  assert.equal(url.searchParams.get('query'), 'pool supply stores');
});

test('includes coordinates when a location is available', () => {
  const url = new URL(buildSupplySearchUrl({ latitude: -33.8688, longitude: 151.2093 }));
  assert.equal(url.searchParams.get('query'), 'pool supply stores near -33.8688,151.2093');
});

test('returns undefined when location access is unavailable', async () => {
  assert.equal(await getSupplySearchLocation(undefined), undefined);
});

test('returns coordinates supplied by browser geolocation', async () => {
  const geolocation = {
    getCurrentPosition(success: PositionCallback) {
      success({ coords: { latitude: 51.5072, longitude: -0.1276 } } as GeolocationPosition);
    },
  } as Geolocation;

  assert.deepEqual(await getSupplySearchLocation(geolocation), {
    latitude: 51.5072,
    longitude: -0.1276,
  });
});
