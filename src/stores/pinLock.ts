import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { generateSalt, hashPin } from '@/lib/pinHash';

interface PinLockState {
  pinEnabled: boolean;
  pinHash: string | null;
  salt: string | null;
  /** Transient — not persisted. Always starts true after reload if pinEnabled. */
  locked: boolean;
  /** Inactivity window in minutes before auto-lock. */
  inactivityTimeoutMinutes: number;
  /** Transient. */
  lastActivity: number;

  setPin: (pin: string) => Promise<void>;
  verifyPin: (pin: string) => Promise<boolean>;
  disablePin: () => void;
  lock: () => void;
  unlock: () => void;
  setTimeoutMinutes: (m: number) => void;
  recordActivity: () => void;
  /** Call once at app boot — sets locked=true if pinEnabled. */
  initLock: () => void;
}

export const usePinLock = create<PinLockState>()(
  persist(
    (set, get) => ({
      pinEnabled: false,
      pinHash: null,
      salt: null,
      locked: false,
      inactivityTimeoutMinutes: 60,
      lastActivity: Date.now(),

      async setPin(pin) {
        const salt = generateSalt();
        const hash = await hashPin(pin, salt);
        set({
          pinEnabled: true,
          pinHash: hash,
          salt,
          locked: false,
          lastActivity: Date.now(),
        });
      },
      async verifyPin(pin) {
        const { pinHash, salt } = get();
        if (!pinHash || !salt) return false;
        const h = await hashPin(pin, salt);
        return h === pinHash;
      },
      disablePin() {
        set({ pinEnabled: false, pinHash: null, salt: null, locked: false });
      },
      lock() {
        if (get().pinEnabled) set({ locked: true });
      },
      unlock() {
        set({ locked: false, lastActivity: Date.now() });
      },
      setTimeoutMinutes(m) {
        set({ inactivityTimeoutMinutes: Math.max(1, m) });
      },
      recordActivity() {
        set({ lastActivity: Date.now() });
      },
      initLock() {
        const { pinEnabled } = get();
        set({ locked: pinEnabled, lastActivity: Date.now() });
      },
    }),
    {
      name: 'kasir.pinlock.v1',
      partialize: (s) => ({
        pinEnabled: s.pinEnabled,
        pinHash: s.pinHash,
        salt: s.salt,
        inactivityTimeoutMinutes: s.inactivityTimeoutMinutes,
      }),
      // Re-lock on every page load if a PIN is set — reloading shouldn't bypass the lock.
      onRehydrateStorage: () => (state) => {
        if (state?.pinEnabled) state.locked = true;
      },
    },
  ),
);
