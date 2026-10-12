import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export const alertVariants = cva(
  'ui-alert relative w-full rounded-xl border-2 px-4 py-3.5 text-sm grid gap-1.5 shadow-sm',
  {
    variants: {
      variant: {
        default: 'ui-alert-default bg-card text-card-foreground border-border/80',
        destructive: 'ui-alert-destructive border-destructive/40 bg-destructive/10 text-destructive',
        success: 'ui-alert-success border-emerald-400/60 bg-emerald-50 text-emerald-900',
        warning: 'ui-alert-warning border-amber-400/60 bg-amber-50 text-amber-900',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export type AlertVariant = NonNullable<VariantProps<typeof alertVariants>['variant']>;

export function Alert({
  className,
  variant,
  ...props
}: HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role={variant === 'destructive' ? 'alert' : 'status'}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}

export function AlertTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h5 data-slot="alert-title" className={cn('font-semibold leading-none', className)} {...props} />;
}

export function AlertDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <div data-slot="alert-description" className={cn('text-sm leading-relaxed', className)} {...props} />;
}
