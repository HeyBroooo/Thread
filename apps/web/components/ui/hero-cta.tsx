'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { Button } from './button';

export function HeroCTA() {
  return (
    <motion.div
      className="hero-actions"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.24, ease: [0.22, 1, 0.36, 1] }}
    >
      <Button asChild size="lg" className="hero-primary px-6 font-semibold shadow-md">
        <Link href="#connect">
          Connect a repository
          <ArrowRight size={16} strokeWidth={2} aria-hidden="true" />
        </Link>
      </Button>
      <Button asChild size="lg" variant="outline" className="hero-outline-btn bg-background/70 px-6">
        <Link href="#how">How it works</Link>
      </Button>
    </motion.div>
  );
}
