const SW_URL = '/sw.js';

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', async () => {
    try {
      await navigator.serviceWorker.register(SW_URL);
    } catch (error) {
      console.error('Service worker registration failed:', error);
    }
  });
}
