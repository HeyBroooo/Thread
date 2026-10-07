'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';

export function HeroCTA() {
  return (
    <motion.div
      className="hero-actions"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.24, ease: [0.22, 1, 0.36, 1] }}
    >
      <Link href="#connect" className="ui-button ui-button-default ui-button-lg hero-primary">
        Connect a repository <ArrowRight size={15} strokeWidth={1.8} aria-hidden="true" />
      </Link>
      <Link href="#how" className="ui-button ui-button-outline ui-button-lg hero-outline-btn">
        How it works
      </Link>
    </motion.div>
  );
}
