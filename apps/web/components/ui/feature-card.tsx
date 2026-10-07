'use client';

import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import { GlareCard } from './glare-card';

interface FeatureCardProps {
  icon: LucideIcon;
  title: string;
  body: string;
}

export function FeatureCard({ icon, title, body }: FeatureCardProps) {
  const Icon = icon;

  // Hover motion lives in `.feature-card:hover` so it stays consistent with the
  // server-rendered feature cards on the repository overview page.
  return (
    <motion.div className="feature-card">
      <GlareCard className="feature-card-glare">
        <div className="icon"><Icon size={18} strokeWidth={1.8} aria-hidden="true" /></div>
        <h3>{title}</h3>
        <p>{body}</p>
      </GlareCard>
    </motion.div>
  );
}
