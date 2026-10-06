'use client';

import Link from 'next/link';
import Image from 'next/image';
import { motion } from 'framer-motion';

export function LandingNav() {
  return (
    <nav className="top-nav">
      <div className="nav-inner">
        <Link href="/" className="nav-brand">
          <Image src="/logo-128.png" alt="Codebase Intelligence" width={30} height={30} className="nav-logo" priority />
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
