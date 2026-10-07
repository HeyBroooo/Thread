import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export function Alert({
  className,
  variant = 'default',
  ...props
}: HTMLAttributes<HTMLDivElement> & { variant?: 'default' | 'destructive' | 'success' }) {
  return (
    <div
      role={variant === 'destructive' ? 'alert' : 'status'}
      className={cn('ui-alert', `ui-alert-${variant}`, className)}
      {...props}
    />
  );
}
