'use client';

import { useState } from 'react';
import { motion, AnimatePresence, useScroll, useMotionValueEvent } from 'framer-motion';
import Link from 'next/link';
import Image from 'next/image';
import { cn } from '@/lib/utils';

export function FloatingNavbar({ className }: { className?: string }) {
  const { scrollYProgress } = useScroll();
  const [visible, setVisible] = useState(true);

  useMotionValueEvent(scrollYProgress, 'change', (current) => {
    if (typeof current !== 'number') return;
    const prev = scrollYProgress.getPrevious();
    if (prev == null) return;
    const direction = current - prev;
    if (scrollYProgress.get() < 0.03) {
      setVisible(true);
    } else if (direction < 0) {
      setVisible(true);
    } else {
      setVisible(false);
    }
  });

  const navItems = [
    { name: 'Connect', link: '#connect' },
    { name: 'Repositories', link: '#repos' },
    { name: 'Features', link: '#features' },
    { name: 'How it works', link: '#how' },
    { name: 'FAQ', link: '#faq' },
  ];

  return (
    <AnimatePresence mode="wait">
      <motion.div
        initial={{ y: -80, opacity: 1 }}
        animate={{ y: visible ? 0 : -80, opacity: visible ? 1 : 0 }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        className={cn(
          'floating-nav',
          'fixed inset-x-0 top-0 z-50',
          'flex items-center justify-between gap-4',
          'px-5 py-3 sm:px-8',
          className,
        )}
      >
        <Link href="/" className="lp-nav-brand">
          <Image src="/logo-128.png" alt="" width={28} height={28} priority />
          <span>Codebase Intelligence</span>
        </Link>

        <nav className="lp-nav-links" aria-label="Primary">
          {navItems.map((item) => (
            <a key={item.name} href={item.link}>
              {item.name}
            </a>
          ))}
        </nav>

        <Link href="#connect" className="lp-nav-cta">
          Get started
        </Link>
      </motion.div>
    </AnimatePresence>
  );
}
