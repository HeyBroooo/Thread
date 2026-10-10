import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export const buttonVariants = cva(
  'ui-button inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'ui-button-default bg-primary text-primary-foreground shadow-sm hover:bg-primary/90',
        destructive: 'ui-button-destructive bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90',
        outline: 'ui-button-outline border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground',
        secondary: 'ui-button-secondary bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80',
        ghost: 'ui-button-ghost hover:bg-accent hover:text-accent-foreground',
        link: 'ui-button-link text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-10 px-4 py-2 has-[>svg]:px-3',
        sm: 'ui-button-sm h-9 gap-1.5 px-3 has-[>svg]:px-2.5',
        lg: 'ui-button-lg h-11 px-6 has-[>svg]:px-4',
        icon: 'ui-button-icon size-9',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>['variant']>;
export type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>['size']>;

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({
  className,
  variant,
  size,
  asChild = false,
  type = 'button',
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      data-slot="button"
      type={asChild ? undefined : type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
