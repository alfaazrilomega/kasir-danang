// Keyboard-wedge barcode scanner.
// USB barcode scanners present themselves as a keyboard and "type" the
// barcode digits very fast followed by Enter. We detect that pattern by
// measuring the time between keystrokes — humans hit ~80–200ms apart, scanners
// burst within 10–30ms. The hook fires `onScan(code)` whenever Enter follows
// a fast-typed sequence and the user is NOT actively typing into a text field.

import { useEffect, useRef } from 'react';

interface Opts {
  onScan: (code: string) => void;
  /** Maximum gap between keystrokes to still be considered "machine-typed". */
  maxIntervalMs?: number;
  /** Minimum length to accept as a barcode. */
  minLength?: number;
  /** Allow scanning even when an input is focused (default false). */
  allowInInputs?: boolean;
}

function isInteractiveTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (el.isContentEditable) return true;
  return false;
}

export function useBarcodeScanner({
  onScan,
  maxIntervalMs = 35,
  minLength = 4,
  allowInInputs = false,
}: Opts) {
  const bufferRef = useRef('');
  const lastTimeRef = useRef(0);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (!allowInInputs && isInteractiveTarget(e.target)) {
        // user is typing into a field — never intercept their keys
        bufferRef.current = '';
        return;
      }
      const now = performance.now();
      const gap = now - lastTimeRef.current;
      lastTimeRef.current = now;

      if (e.key === 'Enter') {
        const code = bufferRef.current;
        bufferRef.current = '';
        if (code.length >= minLength) {
          e.preventDefault();
          onScan(code);
        }
        return;
      }

      // Restart buffer if last key was too long ago — that means a human, not a scanner.
      if (gap > 250 && bufferRef.current.length > 0) {
        bufferRef.current = '';
      }

      // Single printable character?
      if (e.key.length === 1) {
        if (gap <= maxIntervalMs || bufferRef.current.length === 0) {
          bufferRef.current += e.key;
        } else {
          bufferRef.current = e.key;
        }
      }
    }

    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [onScan, maxIntervalMs, minLength, allowInInputs]);
}
