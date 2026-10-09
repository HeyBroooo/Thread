'use client';

import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { cn } from '@/lib/utils';

/**
 * The interactive Spline scene the product is themed around.
 *
 * - `SPLINE_SCENE_URL` is the landing / public backdrop: the scene shown on
 *   every route before the visitor authenticates (and on the public pages).
 * - `DASHBOARD_SPLINE_URL` is the dashboard scene. It replaces the landing
 *   backdrop ONLY on authenticated paths, so a visitor who signs in sees the
 *   dashboard scene instead of the login splash.
 *
 * Both URLs are module-level constants so the site can be asserted against
 * them in tests instead of being duplicated across components.
 */
export const SPLINE_SCENE_URL = 'https://prod.spline.design/bTZSSbAPA2lktqwZ/scene.splinecode';
export const DASHBOARD_SPLINE_URL = 'https://prod.spline.design/bTZSSbAPA2lktqwZ/scene.splinecode';
const SPLINE_VIEWER_SRC =
  'https://cdn.spline.design/@splinetool/viewer@2.0.75/build/spline-viewer.js';

/**
 * The viewer is a web component, so the module has to be injected once before
 * any `<spline-viewer>` element can upgrade. Several backgrounds mount in a
 * session (route changes remount the layout), hence the shared promise.
 */
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
    script.addEventListener('error', () => reject(new Error('Spline viewer failed to load')));
    document.head.append(script);
  });

  return viewerModule;
}

/**
 * Fixed, full-viewport 3D backdrop that sits behind every route.
 *
 * The element is created imperatively (rather than as JSX) because `spline-viewer`
 * is an untyped custom element whose attributes must be set before insertion so
 * the scene starts on the right URL. `pointer-events: none` everywhere keeps the
 * canvas, chat and scroll interactions working normally on top of it.
 */
export function SplineBackground({
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
        viewer.setAttribute('url', SPLINE_SCENE_URL);
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
        // blocked CDN (offline, strict CSP) degrades gracefully with no console
        // noise and no layout shift.
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
      {/* Brand gradient base. The scene is composited with `screen`, so where the
          canvas is black or missing this gradient is what the user sees — the
          backdrop can never collapse into a muddy grey. */}
      <div className="absolute inset-0 bg-[linear-gradient(160deg,#041713_0%,#061c18_38%,#04121c_72%,#030b10_100%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_-10%,rgba(52,211,153,0.20),transparent_60%),radial-gradient(90%_70%_at_85%_110%,rgba(56,189,248,0.16),transparent_62%)]" />

      <div ref={hostRef} className="absolute inset-0 mix-blend-screen" style={{ opacity }} />

      {scrimClassName ? <div className={cn('absolute inset-0', scrimClassName)} /> : null}
    </div>
  );
}
