import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { EmptyBoxIcon } from './icons';

/**
 * What a list or screen shows when there is nothing in it yet. An empty screen should say what is
 * missing, why, and what to do next, in plain words, not just "No data".
 *
 *   <EmptyState title="No products yet" description="Add your first product to start billing."
 *               action={<Button variant="primary">Add product</Button>} />
 *
 * `headingLevel` must fit the page's heading order (h2 under a page title, h3 inside a section).
 */
export interface EmptyStateProps {
  title: string;
  description?: string;
  /** Usually a Button that fixes the emptiness. */
  action?: ReactNode;
  headingLevel?: 2 | 3 | 4;
  /** Replace the default picture. Decorative; hidden from screen readers. */
  icon?: ReactNode;
  className?: string;
}

export function EmptyState({
  title,
  description,
  action,
  headingLevel = 2,
  icon,
  className,
}: EmptyStateProps) {
  const Heading = `h${headingLevel}` as const;
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-3 rounded-card border border-dashed border-line px-6 py-12 text-center',
        className,
      )}
    >
      <div aria-hidden className="text-muted">
        {icon ?? <EmptyBoxIcon className="size-10" />}
      </div>
      <Heading className="text-body font-medium">{title}</Heading>
      {description && <p className="max-w-prose text-small text-muted">{description}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
