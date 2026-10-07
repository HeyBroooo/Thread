import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export function Separator({
  className,
  orientation = 'horizontal',
  ...props
}: HTMLAttributes<HTMLDivElement> & { orientation?: 'horizontal' | 'vertical' }) {
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={cn('ui-separator', `ui-separator-${orientation}`, className)}
      {...props}
    />
  );
}
