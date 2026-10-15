'use client';

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FaqItem {
  q: string;
  a: string;
}

const DEFAULT_ITEMS: FaqItem[] = [
  {
    q: 'How is the graph actually built?',
    a: 'A static parser (ts-morph) reads your local checkout — files, symbols, imports, calls, JSX, HTTP targets and server routes — and assembles nodes and edges with source evidence and a confidence value. No browser crawl, ever.',
  },
  {
    q: 'Does the AI make up the answers?',
    a: 'No. Retrieval runs first: search, bounded graph traversal, compact evidence — then the model answers and the answer is validated against the graph. Every claim cites exact file and line.',
  },
  {
    q: 'What happens when I open a pull request?',
    a: 'The diff is mapped to changed symbols and direct plus indirect dependents are computed, so reviewers see the real blast radius instead of just the changed lines.',
  },
  {
    q: 'Where does my code go?',
    a: 'Repositories are cloned into isolated workspace directories. Private repositories use the GitHub token you connect to your own account; approval and merge stay on GitHub.',
  },
  {
    q: 'Which languages are supported?',
    a: 'TypeScript and JavaScript today — TSX/JSX, ES modules, CommonJS, decorators, generics and async patterns. The parser version on each repository tells you exactly what ran.',
  },
];

/** Magic-UI style FAQ accordion with animated expand/collapse. */
export function FaqAccordion({ items = DEFAULT_ITEMS, className }: { items?: FaqItem[]; className?: string }) {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <div className={cn('lp-faq', className)}>
      {items.map((item, i) => {
        const isOpen = open === i;
        return (
          <div key={item.q} className={cn('lp-faq-item', isOpen && 'is-open')}>
            <button
              type="button"
              className="lp-faq-trigger"
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? null : i)}
            >
              <span>{item.q}</span>
              <Plus
                size={16}
                strokeWidth={2}
                aria-hidden="true"
                className="lp-faq-icon"
              />
            </button>
            <AnimatePresence initial={false}>
              {isOpen ? (
                <motion.div
                  key="body"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                  className="lp-faq-body"
                >
                  <p>{item.a}</p>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}
