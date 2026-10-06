'use client';

import { motion } from 'framer-motion';

export function HeroSub() {
  return (
    <motion.p
      className="hero-sub"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.16, ease: [0.22, 1, 0.36, 1] }}
    >
      One evidence-backed graph for architecture, grounded answers, and
      change-aware reviews.
    </motion.p>
  );
}
