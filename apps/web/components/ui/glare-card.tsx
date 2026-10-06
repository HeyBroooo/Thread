'use client';

import { forwardRef } from 'react';
import { motion, type HTMLMotionProps } from 'framer-motion';

export const GlareCard = forwardRef<
  HTMLDivElement,
  Omit<HTMLMotionProps<'div'>, 'ref'> & { hover?: boolean }
>(function GlareCard({ className = '', hover = true, children, ...props }, ref) {
  return (
    <motion.div
      ref={ref}
      className={`glare-card ${className}`.trim()}
      whileHover={hover ? { y: -2 } : undefined}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      {...props}
    >
      {children as React.ReactNode}
    </motion.div>
  );
});
GlareCard.displayName = 'GlareCard';
