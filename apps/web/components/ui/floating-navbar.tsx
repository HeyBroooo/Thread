'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { gsap } from 'gsap';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { name: 'Connect', link: '#connect' },
  { name: 'Repositories', link: '#repos' },
  { name: 'Features', link: '#features' },
  { name: 'How it works', link: '#how' },
  { name: 'FAQ', link: '#faq' },
];

/**
 * The landing navbar.
 *
 * Two behaviours matter here:
 *  - Animation runs through GSAP (entrance + scroll-direction hide) rather than
 *    Framer Motion, so motion across the app comes from one library.
 *  - The call to action is auth-aware. A signed-in visitor already has a
 *    workspace, so "Get started" is replaced by a link into the dashboard
 *    instead of advertising a sign-up they do not need.
 */
export function FloatingNavbar({ className }: { className?: string }) {
  const navRef = useRef<HTMLDivElement>(null);
  const hiddenRef = useRef(false);
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    void api
      .authSession()
      .then((session) => setAuthenticated(session.authenticated))
      .catch(() => setAuthenticated(false));
  }, []);

  // Entrance.
  useEffect(() => {
    const el = navRef.current;
    if (!el) return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      gsap.set(el, { y: 0, autoAlpha: 1 });
      return;
    }

    const ctx = gsap.context(() => {
      gsap.fromTo(
        el,
        { y: -80, autoAlpha: 0 },
        { y: 0, autoAlpha: 1, duration: 0.55, ease: 'power3.out' },
      );
    }, el);

    return () => ctx.revert();
  }, []);

  // Hide on scroll-down, reveal on scroll-up or at the top.
  useEffect(() => {
    const el = navRef.current;
    if (!el) return;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let lastY = window.scrollY;

    const onScroll = () => {
      const y = window.scrollY;
      const shouldHide = y > 24 && y > lastY;
      lastY = y;
      if (shouldHide === hiddenRef.current) return;
      hiddenRef.current = shouldHide;

      if (reduce) {
        gsap.set(el, { autoAlpha: shouldHide ? 0 : 1 });
        return;
      }
      gsap.to(el, {
        y: shouldHide ? -80 : 0,
        autoAlpha: shouldHide ? 0 : 1,
        duration: 0.32,
        ease: 'power2.out',
      });
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div
      ref={navRef}
      className={cn(
        'floating-nav',
        'fixed inset-x-0 top-0 z-50',
        'flex items-center justify-between gap-4',
        'px-5 py-3 sm:px-8',
        className,
      )}
    >
      <Link href="/" className="lp-nav-brand">
        <Image src="/logo-128.png" alt="" width={28} height={28} priority />
        <span>Codebase Intelligence</span>
      </Link>

      <nav className="lp-nav-links" aria-label="Primary">
        {NAV_ITEMS.map((item) => (
          <a key={item.name} href={item.link}>
            {item.name}
          </a>
        ))}
      </nav>

      {authenticated ? (
        <Link href="#repos" className="lp-nav-cta">
          Dashboard
        </Link>
      ) : (
        <Link href="#connect" className="lp-nav-cta">
          Get started
        </Link>
      )}
    </div>
  );
}
