import type { ReactNode } from 'react';
import { TopNav } from './TopNav';

/**
 * Standard page shell: top navigation over a centred content column. The admin
 * console uses `AdminLayout` instead, which swaps the top nav for a module rail.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <TopNav />
      <main className="mx-auto max-w-[1400px] px-4 py-6 md:px-6">{children}</main>
    </div>
  );
}
