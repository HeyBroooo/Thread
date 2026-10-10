'use client';

import Image from 'next/image';
import { motion } from 'framer-motion';

export function HeroLogo() {
  return (
    <motion.div
      className="hero-logo"
      initial={{ opacity: 0, scale: 0.9, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
    >
      <Image src="/logo-512.png" alt="Codebase Intelligence" width={148} height={148} priority />
    </motion.div>
  );
}
