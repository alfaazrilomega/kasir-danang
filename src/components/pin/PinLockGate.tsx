import { useEffect, useRef } from 'react';
import { useAuth } from '@/stores/auth';
import { usePinLock } from '@/stores/pinLock';
import { PinLockScreen } from './PinLockScreen';

const ACTIVITY_EVENTS: (keyof DocumentEventMap)[] = [
  'mousemove',
  'mousedown',
  'keydown',
  'touchstart',
  'scroll',
  'wheel',
];

// Throttle activity records to once per this window (ms).
const ACTIVITY_THROTTLE_MS = 15_000;
// Frequency at which the inactivity timer is checked (ms).
const CHECK_INTERVAL_MS = 30_000;

export function PinLockGate({ children }: { children: React.ReactNode }) {
  const authed = useAuth((s) => !!s.profile);
  const pinEnabled = usePinLock((s) => s.pinEnabled);
  const locked = usePinLock((s) => s.locked);
  const inactivityTimeoutMinutes = usePinLock((s) => s.inactivityTimeoutMinutes);
  const initLock = usePinLock((s) => s.initLock);
  const lock = usePinLock((s) => s.lock);
  const recordActivity = usePinLock((s) => s.recordActivity);
  const initRan = useRef(false);
  const lastRecordRef = useRef(0);

  // On first mount after sign-in, kick the lock if a PIN is set.
  useEffect(() => {
    if (initRan.current) return;
    if (authed && pinEnabled) {
      initLock();
      initRan.current = true;
    }
  }, [authed, pinEnabled, initLock]);

  // Activity tracking + inactivity timer.
  useEffect(() => {
    if (!authed || !pinEnabled || locked) return;

    const onActivity = () => {
      const now = Date.now();
      if (now - lastRecordRef.current < ACTIVITY_THROTTLE_MS) return;
      lastRecordRef.current = now;
      recordActivity();
    };

    ACTIVITY_EVENTS.forEach((ev) =>
      window.addEventListener(ev, onActivity, { passive: true }),
    );

    const timer = window.setInterval(() => {
      const last = usePinLock.getState().lastActivity;
      const timeoutMs = inactivityTimeoutMinutes * 60_000;
      if (Date.now() - last >= timeoutMs) lock();
    }, CHECK_INTERVAL_MS);

    return () => {
      ACTIVITY_EVENTS.forEach((ev) => window.removeEventListener(ev, onActivity));
      window.clearInterval(timer);
    };
  }, [authed, pinEnabled, locked, inactivityTimeoutMinutes, lock, recordActivity]);

  if (authed && pinEnabled && locked) {
    return (
      <>
        {children}
        <PinLockScreen />
      </>
    );
  }
  return <>{children}</>;
}
