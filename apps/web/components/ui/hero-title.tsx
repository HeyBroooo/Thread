'use client';

import { motion } from 'framer-motion';

export function HeroTitle() {
  return (
    <motion.h1
      initial={{ opacity: 0, y: 22 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
      className="hero-title"
    >
      Understand your codebase
      <br />
      <span className="hero-title-accent">before you change it.</span>
    </motion.h1>
  );
}
