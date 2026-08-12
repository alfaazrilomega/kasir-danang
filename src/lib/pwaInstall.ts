import { useEffect, useMemo, useState } from 'react';

type InstallOutcome = 'accepted' | 'dismissed' | 'unavailable';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: InstallOutcome; platform: string }>;
  prompt: () => Promise<void>;
}

interface PwaInstallSnapshot {
  canInstall: boolean;
  installed: boolean;
  isSupported: boolean;
}

let initialized = false;
let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installed = getStandaloneState();
const subscribers = new Set<() => void>();

export function usePwaInstall() {
  const [snapshot, setSnapshot] = useState<PwaInstallSnapshot>(() => getSnapshot());

  useEffect(() => {
    initPwaInstallEvents();
    const update = () => setSnapshot(getSnapshot());
    subscribers.add(update);
    update();
    return () => {
      subscribers.delete(update);
    };
  }, []);

  const promptInstall = useMemo(
    () => async (): Promise<InstallOutcome> => {
      initPwaInstallEvents();
      if (!deferredPrompt || installed) return 'unavailable';

      const promptEvent = deferredPrompt;
      deferredPrompt = null;
      notify();

      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      if (choice.outcome === 'accepted') {
        installed = true;
      }
      notify();
      return choice.outcome;
    },
    [],
  );

  return { ...snapshot, promptInstall };
}

function initPwaInstallEvents() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    installed = getStandaloneState();
    notify();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    installed = true;
    notify();
  });

  const media = window.matchMedia?.('(display-mode: standalone)');
  media?.addEventListener?.('change', () => {
    installed = getStandaloneState();
    if (installed) deferredPrompt = null;
    notify();
  });
}

function getSnapshot(): PwaInstallSnapshot {
  installed = getStandaloneState();
  return {
    canInstall: Boolean(deferredPrompt) && !installed,
    installed,
    isSupported:
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      ('BeforeInstallPromptEvent' in window || Boolean(deferredPrompt) || installed),
  };
}

function getStandaloneState(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.matchMedia?.('(display-mode: window-controls-overlay)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function notify() {
  subscribers.forEach((fn) => fn());
}
