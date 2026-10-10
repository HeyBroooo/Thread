'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';

export function LandingNav() {
  return (
    <nav className="top-nav">
      <div className="nav-inner">
        <Link href="/" className="nav-brand">
          <span className="nav-logo-mark" aria-hidden="true">
            <svg width="26" height="26" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect width="26" height="26" rx="7" fill="url(#navMarkGrad)" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round"/>
              <path d="M8.6 14.4 12.6 16.8l4.2-4.2" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <defs>
                <linearGradient id="navMarkGrad" x1="0" y1="0" x2="26" y2="26" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#34d399"/>
                  <stop offset="1" stopColor="#38bdf8"/>
                </linearGradient>
              </defs>
            </svg>
          </span>
          <span className="nav-brand-text">Codebase Intelligence</span>
        </Link>
        <div className="nav-links">
          <a href="#repos">Repositories</a>
          <a href="#how">How it works</a>
          <a href="#connect" className="nav-cta">
            Connect
          </a>
        </div>
      </div>
    </nav>
  );
}
