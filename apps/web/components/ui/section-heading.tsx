'use client';

import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface SectionHeadingProps {
  eyebrow: string;
  title: React.ReactNode;
  sub?: React.ReactNode;
  align?: 'center' | 'left';
  className?: string;
}

/** Eyebrow + display heading, the signature section header of Magic UI sites. */
export function SectionHeading({ eyebrow, title, sub, align = 'center', className }: SectionHeadingProps) {
  return (
    <div
      className={cn(
        'mx-auto mb-10 flex max-w-3xl flex-col gap-4',
        align === 'center' ? 'items-center text-center' : 'items-start text-left',
        className,
      )}
    >
      <motion.span
        initial={{ opacity: 0, y: 10 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-60px' }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="font-mono text-[13px] font-semibold uppercase tracking-[0.16em] text-primary"
      >
        {eyebrow}
      </motion.span>
      <motion.h2
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-60px' }}
        transition={{ duration: 0.5, delay: 0.06, ease: [0.22, 1, 0.36, 1] }}
        className="m-0 text-[clamp(30px,4.2vw,50px)] font-bold leading-[1.06] tracking-[-0.04em] text-foreground"
      >
        {title}
      </motion.h2>
      {sub ? (
        <motion.p
          initial={{ opacity: 0, y: 14 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.5, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
          className="m-0 max-w-xl text-[16px] leading-relaxed text-muted-foreground"
        >
          {sub}
        </motion.p>
      ) : null}
    </div>
  );
}
