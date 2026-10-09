'use client';

import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { cn } from '@/lib/utils';

/**
 * The interactive Spline scene the dashboard is themed around. `/build` is
 * skipped so the scene loads over the full window instead of sitting beside
 * the repository shell.
 */
export const DASHBOARD_SPLINE_URL =
  'https://prod.spline.design/bTZSSbAPA2lktqwZ/scene.splinecode';

const SPLINE_VIEWER_SRC =
  'https://cdn.spline.design/@splinetool/viewer@2.0.75/build/spline-viewer.js';

let viewerModule: Promise<void> | null = null;

function loadSplineViewer(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (customElements.get('spline-viewer')) return Promise.resolve();
  if (viewerModule) return viewerModule;

  viewerModule = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.type = 'module';
    script.async = true;
    script.src = SPLINE_VIEWER_SRC;
    script.addEventListener('load', () => resolve());
    script.addEventListener('error', () =>
      reject(new Error('Spline viewer failed to load'))
    );
    document.head.append(script);
  });

  return viewerModule;
}

/**
 * Full-window 3D backdrop for the dashboard. The scene is composited with
 * `screen` so it spans the entire viewport behind the repository shell, canvas
 * and chat. `pointerEvents: none` keeps those surfaces interactive on top of
 * the animation.
 */
export function DashboardSplineBackground({
  className,
  opacity = 1,
  scrimClassName = 'bg-[radial-gradient(120%_100%_at_50%_0%,transparent_30%,rgba(3,11,16,0.66)_100%)]',
}: {
  className?: string;
  opacity?: number;
  scrimClassName?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let cancelled = false;

    void loadSplineViewer()
      .then(() => {
        if (cancelled || !hostRef.current) return;

        const viewer = document.createElement('spline-viewer');
        viewer.setAttribute('url', DASHBOARD_SPLINE_URL);
        viewer.setAttribute('loading-anim-type', 'none');
        viewer.style.display = 'block';
        viewer.style.width = '100%';
        viewer.style.height = '100%';
        viewer.style.pointerEvents = 'none';

        hostRef.current.replaceChildren(viewer);

        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          gsap.set(viewer, { autoAlpha: 1 });
        } else {
          gsap.fromTo(
            viewer,
            { autoAlpha: 0, scale: 1.06 },
            { autoAlpha: 1, scale: 1, duration: 1.6, ease: 'power2.out' },
          );
        }
      })
      .catch(() => {
        // The gradient base and scrim below are the designed fallback, so a
        // blocked CDN (offline, strict CSP) degrades gracefully with no
        // console noise and no layout shift.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div
      aria-hidden="true"
      className={cn('pointer-events-none fixed inset-0 -z-10 overflow-hidden', className)}
    >
      <div className="absolute inset-0 bg-[linear-gradient(160deg,#041713_0%,#061c18_38%,#04121c_72%,#030b10_100%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_-10%,rgba(52,211,153,0.20),transparent_60%),radial-gradient(90%_70%_at_85%_110%,rgba(56,189,248,0.16),transparent_62%)]" />

      <div ref={hostRef} className="absolute inset-0 mix-blend-screen" style={{ opacity }} />

      {scrimClassName ? (
        <div className={cn('absolute inset-0', scrimClassName)} />
      ) : null}
    </div>
  );
}
