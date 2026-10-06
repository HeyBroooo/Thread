'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';

function AnimatedNumber({ value }: { value: number }) {
  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);
  useEffect(() => {
    const from = fromRef.current;
    if (from === value) {
      setDisplay(value);
      return;
    }
    const start = performance.now();
    const duration = 700;
    let raf = 0;
    function tick(now: number) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(from + (value - from) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = value;
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{display.toLocaleString()}</>;
}

export function HeroStats({ repositories, totalNodes, totalEdges, totalFiles }: {
  repositories: { id: string; indexStatus: string; latestJob?: { nodesCreated?: number; edgesCreated?: number; filesProcessed?: number } | null }[];
  totalNodes: number;
  totalEdges: number;
  totalFiles: number;
}) {
  return (
    <motion.div
      className="hero-stats"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.34, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="hero-stat">
        <div className="value">
          <AnimatedNumber value={repositories.length} />
        </div>
        <div className="key">repositories</div>
      </div>
      <div className="hero-stat">
        <div className="value">
          <AnimatedNumber value={totalNodes} />
        </div>
        <div className="key">graph nodes</div>
      </div>
      <div className="hero-stat">
        <div className="value">
          <AnimatedNumber value={totalEdges} />
        </div>
        <div className="key">relationships</div>
      </div>
      <div className="hero-stat">
        <div className="value">
          <AnimatedNumber value={totalFiles} />
        </div>
        <div className="key">files parsed</div>
      </div>
    </motion.div>
  );
}
