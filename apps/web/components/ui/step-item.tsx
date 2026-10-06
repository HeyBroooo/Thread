'use client';

import { motion } from 'framer-motion';

interface StepItemProps {
  number: string;
  title: string;
  description: string;
}

export function StepItem({ number, title, description }: StepItemProps) {
  return (
    <motion.li
      className="step-item"
      whileHover={{ x: 4 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
    >
      <span className="step-number">{number}</span>
      <strong className="step-title">{title}</strong>
      <span className="step-description">{description}</span>
    </motion.li>
  );
}
