'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { gsap } from 'gsap';
import { ArrowRight } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from './button';

/**
 * Hero call to action.
 *
 * When the visitor is already signed in, "Connect a repository" is an odd thing
 * to lead with — they have repositories. The primary action switches to
 * jumping into the dashboard list instead.
 */
export function HeroCTA() {
  const actionsRef = useRef<HTMLDivElement>(null);
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    void api
      .authSession()
      .then((session) => setAuthenticated(session.authenticated))
      .catch(() => setAuthenticated(false));
  }, []);

  useEffect(() => {
    const el = actionsRef.current;
    if (!el) return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      gsap.set(el, { y: 0, autoAlpha: 1 });
      return;
    }

    const ctx = gsap.context(() => {
      gsap.fromTo(
        el,
        { y: 14, autoAlpha: 0 },
        { y: 0, autoAlpha: 1, duration: 0.6, delay: 0.24, ease: 'power3.out' },
      );
    }, el);

    return () => ctx.revert();
  }, []);

  return (
    <div ref={actionsRef} className="hero-actions">
      {authenticated ? (
        <Button asChild size="lg" className="hero-primary px-6 font-semibold shadow-md">
          <Link href="#repos">
            View your repositories
            <ArrowRight size={16} strokeWidth={2} aria-hidden="true" />
          </Link>
        </Button>
      ) : (
        <Button asChild size="lg" className="hero-primary px-6 font-semibold shadow-md">
          <Link href="#connect">
            Connect a repository
            <ArrowRight size={16} strokeWidth={2} aria-hidden="true" />
          </Link>
        </Button>
      )}
      <Button asChild size="lg" variant="outline" className="hero-outline-btn px-6">
        <Link href="#how">How it works</Link>
      </Button>
    </div>
  );
}
