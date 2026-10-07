import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" data-slot="skeleton" className={cn('ui-skeleton animate-pulse rounded-md bg-muted', className)} {...props} />;
}
