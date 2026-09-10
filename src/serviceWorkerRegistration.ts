import { registerSW } from 'virtual:pwa-register';

export function registerServiceWorker() {
  // autoUpdate mode: once a newly-installed worker activates, the page
  // reloads so the user is never left running a stale bundle.
  registerSW({
    onRegisterError(error) {
      console.error('Service worker registration failed:', error);
    },
  });
}
