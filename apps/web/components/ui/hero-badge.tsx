'use client';

import { motion } from 'framer-motion';

export function HeroBadge({ children }: { children: React.ReactNode }) {
  return (
    <motion.span
      className="hero-badge"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
    >
      <span className="pulse-dot" />
      {children}
    </motion.span>
  );
}
