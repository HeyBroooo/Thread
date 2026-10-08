'use client';

import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FeatureRowProps {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  body: string;
  bullets?: string[];
  /** Product mock rendered opposite the copy. */
  visual: React.ReactNode;
  /** Flip the visual to the left side. */
  reverse?: boolean;
}

/**
 * Magic-UI style alternating feature row: big copy on one side,
 * a living product mock on the other.
 */
export function FeatureRow({ icon: Icon, eyebrow, title, body, bullets, visual, reverse }: FeatureRowProps) {
  return (
    <div className={cn('lp-feature-row', reverse && 'lp-feature-row-reverse')}>
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-80px' }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        className="lp-feature-copy"
      >
        <span className="lp-feature-icon" aria-hidden="true">
          <Icon size={18} strokeWidth={1.8} />
        </span>
        <span className="font-mono text-[12px] font-semibold uppercase tracking-[0.16em] text-primary">
          {eyebrow}
        </span>
        <h3 className="m-0 text-[clamp(26px,3vw,38px)] font-bold leading-[1.1] tracking-[-0.035em] text-foreground">
          {title}
        </h3>
        <p className="m-0 text-[15.5px] leading-relaxed text-muted-foreground">{body}</p>
        {bullets && bullets.length > 0 ? (
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0 pt-1">
            {bullets.map((bullet) => (
              <li key={bullet} className="flex items-start gap-2.5 text-[14px] leading-snug text-foreground/85">
                <span className="lp-bullet-dot" aria-hidden="true" />
                {bullet}
              </li>
            ))}
          </ul>
        ) : null}
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 28, scale: 0.985 }}
        whileInView={{ opacity: 1, y: 0, scale: 1 }}
        viewport={{ once: true, margin: '-80px' }}
        transition={{ duration: 0.6, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
        className="lp-feature-visual"
      >
        {visual}
      </motion.div>
    </div>
  );
}
