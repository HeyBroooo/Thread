'use client';

import { motion } from 'framer-motion';
import { Marquee } from './marquee';

const TECH = [
  'TypeScript',
  'JavaScript',
  'TSX',
  'JSX',
  'React',
  'Next.js',
  'Node.js',
  'ES Modules',
  'CommonJS',
  'async / await',
  'Decorators',
  'Generics',
];

/** Infinite marquee of everything the static parser understands. */
export function TechMarquee() {
  return (
    <section aria-label="Supported technologies" className="lp-marquee-section">
      <motion.p
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5 }}
        className="mb-5 text-center font-mono text-[12px] font-semibold uppercase tracking-[0.18em] text-muted-foreground"
      >
        Parsed natively from your checkout — never crawled
      </motion.p>
      <div className="lp-marquee-fade">
        <Marquee repeat={3} pauseOnHover className="lp-marquee">
          {TECH.map((tech) => (
            <span key={tech} className="lp-chip">
              {tech}
            </span>
          ))}
        </Marquee>
      </div>
    </section>
  );
}
