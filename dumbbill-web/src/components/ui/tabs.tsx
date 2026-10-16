'use client';

import { Tabs as RadixTabs } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

/**
 * Tabs: switch between views of the same thing (for example Details / Stock / History of a product).
 *
 * Built on Radix Tabs: Left/Right arrows move between tabs, Home/End jump to the ends, Tab moves into
 * the panel, and the roles and selected state are announced correctly.
 * Look: a plain row with a 2px accent underline under the selected tab (no pills, no boxes).
 *
 *   <Tabs defaultValue="details">
 *     <TabsList aria-label="Product views">
 *       <TabsTrigger value="details">Details</TabsTrigger>
 *       <TabsTrigger value="stock">Stock</TabsTrigger>
 *     </TabsList>
 *     <TabsContent value="details">...</TabsContent>
 *     <TabsContent value="stock">...</TabsContent>
 *   </Tabs>
 */
export function Tabs(props: ComponentProps<typeof RadixTabs.Root>) {
  return <RadixTabs.Root {...props} />;
}

export function TabsList({ className, ...props }: ComponentProps<typeof RadixTabs.List>) {
  return <RadixTabs.List className={cn('flex gap-6 border-b border-line', className)} {...props} />;
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof RadixTabs.Trigger>) {
  return (
    <RadixTabs.Trigger
      className={cn(
        '-mb-px min-h-(--size-control-md) border-b-2 border-transparent text-small font-medium text-muted',
        'transition-colors duration-(--duration-micro) ease-enter hover:text-ink',
        'data-[state=active]:border-accent data-[state=active]:text-ink',
        'disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: ComponentProps<typeof RadixTabs.Content>) {
  return <RadixTabs.Content className={cn('pt-4', className)} {...props} />;
}
