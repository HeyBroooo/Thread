'use client';

import { motion } from 'framer-motion';

export function HeroLogo() {
  return (
    <motion.div
      className="hero-logo"
      initial={{ opacity: 0, scale: 0.9, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
    >
      <motion.span
        animate={{ rotate: 360 }}
        transition={{ duration: 180, repeat: Infinity, ease: 'linear' }}
        style={{ display: 'block', transformOrigin: '44px 44px' }}
      >
        <svg width="88" height="88" viewBox="0 0 88 88" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="heroMarkGrad2" x1="0" y1="0" x2="88" y2="88" gradientUnits="userSpaceOnUse">
              <stop stopColor="#34d399"/>
              <stop offset="1" stopColor="#38bdf8"/>
            </linearGradient>
            <radialGradient id="heroMarkGlow2" cx="50%" cy="50%" r="50%">
              <stop stopColor="#34d399" stopOpacity="0.35"/>
              <stop offset="1" stopColor="#34d399" stopOpacity="0"/>
            </radialGradient>
          </defs>
          <circle cx="44" cy="44" r="40" fill="url(#heroMarkGlow2)"/>
          <circle cx="44" cy="44" r="20" fill="url(#heroMarkGrad2)" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5"/>
          <g stroke="rgba(255,255,255,0.7)" strokeWidth="2" strokeLinecap="round">
            <path d="M44 26v16"/>
            <path d="M44 46v16"/>
            <path d="M26 44h16"/>
          </g>
          <circle cx="44" cy="44" r="5" fill="#fff"/>
        </svg>
      </motion.span>
    </motion.div>
  );
}
