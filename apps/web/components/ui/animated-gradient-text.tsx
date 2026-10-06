'use client';

import { CSSProperties } from 'react';

export function AnimatedGradientText({
  children,
  className = '',
  gradient = 'linear-gradient(135deg, #4ad9ff 0%, #5b7cff 34%, #8b5cf6 64%, #d95cff 100%)',
  onMouseEnter,
  onMouseLeave,
}: {
  children: React.ReactNode;
  className?: string;
  gradient?: string;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) {
  const style: CSSProperties = {
    background: gradient,
    backgroundSize: '300% 300%',
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    animation: 'animatedGradient 6s ease infinite',
  };
  return (
    <span
      className={`cursor-default ${className}`}
      style={style}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {children}
    </span>
  );
}
