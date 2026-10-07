import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export function Badge({
  className,
  variant = 'default',
  ...props
}: HTMLAttributes<HTMLSpanElement> & { variant?: 'default' | 'secondary' | 'outline' | 'destructive' }) {
  return <span className={cn('ui-badge', `ui-badge-${variant}`, className)} {...props} />;
}
