'use client';

import { useState } from 'react';
import { motion, AnimatePresence, useScroll, useMotionValueEvent } from 'framer-motion';
import Link from 'next/link';
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
    { name: 'Repositories', link: '#repos' },
    { name: 'How it works', link: '#how' },
    { name: 'Connect', link: '#connect' },
  ];

  return (
    <AnimatePresence mode="wait">
      <motion.div
        initial={{ opacity: 1, y: -120 }}
        animate={{ y: visible ? 0 : -120, opacity: visible ? 1 : 0 }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        className={cn(
          'floating-nav',
          'fixed z-50 top-4 inset-x-0 mx-auto px-4 sm:px-6 py-3 sm:py-4 rounded-xl',
          'border border-solid',
          'flex items-center justify-center gap-1 sm:gap-5',
          'shadow-[0_2px_6px_-2px_rgba(25,46,34,0.08),0_1px_0_0_rgba(25,46,34,0.04),0_0_0_1px_rgba(25,46,34,0.06)]',
          'hover:shadow-[0_8px_24px_-6px_rgba(25,46,34,0.12),0_0_0_1px_rgba(25,46,34,0.08)]',
          'transition-shadow duration-200',
          className,
        )}
        style={{
          // Fit the content instead of a fixed viewport share, so the bar stays on
          // one line on phones rather than wrapping under itself.
          maxWidth: 'calc(100% - 32px)',
          width: 'fit-content',
          backdropFilter: 'blur(18px) saturate(180%)',
          WebkitBackdropFilter: 'blur(18px) saturate(180%)',
          background: 'rgba(255, 255, 255, 0.88)',
          borderColor: 'var(--border)',
          borderRadius: '14px',
        }}
      >
        {navItems.map((item, idx) => (
          <Link
            key={idx}
            href={item.link}
            className={cn(
              'relative inline-flex items-center gap-1.5 text-sm font-medium',
              'text-foreground hover:text-accent transition-colors duration-140',
              'rounded-lg px-3 py-1.5 -mx-1.5 -my-1.5',
              'hover:bg-accent-soft',
              idx === navItems.length - 1
                ? 'bg-accent text-white font-semibold shadow-[0_2px_6px_-2px_rgba(47,118,89,0.3)] hover:bg-accent hover:shadow-[0_4px_12px_-4px_rgba(47,118,89,0.4)]'
                : '',
            )}
            style={idx === navItems.length - 1 ? { color: '#fff' } : {}}
          >
            {item.name}
          </Link>
        ))}
      </motion.div>
    </AnimatePresence>
  );
}
