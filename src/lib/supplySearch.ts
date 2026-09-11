export interface SupplySearchLocation {
  latitude: number;
  longitude: number;
}

const GOOGLE_MAPS_SEARCH_BASE = 'https://www.google.com/maps/search/';
const SUPPLY_SEARCH_QUERY = 'pool supply stores';

export function buildSupplySearchUrl(location?: SupplySearchLocation): string {
  const query = location
    ? `${SUPPLY_SEARCH_QUERY} near ${location.latitude},${location.longitude}`
    : SUPPLY_SEARCH_QUERY;

  const params = new URLSearchParams({ api: '1', query });
  return `${GOOGLE_MAPS_SEARCH_BASE}?${params.toString()}`;
}

export function getSupplySearchLocation(
  geolocation: Geolocation | undefined,
  timeoutMs = 8_000,
): Promise<SupplySearchLocation | undefined> {
  if (!geolocation) return Promise.resolve(undefined);

  return new Promise((resolve) => {
    geolocation.getCurrentPosition(
      ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude }),
      () => resolve(undefined),
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 5 * 60 * 1_000 },
    );
  });
}
