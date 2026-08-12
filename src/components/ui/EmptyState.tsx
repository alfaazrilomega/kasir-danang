import type { ReactNode } from 'react';
import { Inbox } from 'lucide-react';

interface Props {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ title, description, icon, action }: Props) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="rounded-full bg-ink-100 dark:bg-ink-800 p-4 mb-3 text-ink-500">
        {icon ?? <Inbox size={24} />}
      </div>
      <h4 className="font-semibold">{title}</h4>
      {description && <p className="mt-1 text-sm text-ink-500 max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
