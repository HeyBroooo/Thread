'use client';

import { forwardRef } from 'react';
import { motion, type HTMLMotionProps } from 'framer-motion';

export const ShimmerButton = forwardRef<
  HTMLButtonElement,
  Omit<HTMLMotionProps<'button'>, 'ref'>
>(function ShimmerButton({ className = '', children, ...props }, ref) {
  return (
    <motion.button
      ref={ref}
      className={`shimmer-button ${className}`.trim()}
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.99 }}
      {...props}
    >
      {children as React.ReactNode}
    </motion.button>
  );
});
ShimmerButton.displayName = 'ShimmerButton';
