'use client';

import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { cn } from '@/lib/utils';

/**
 * Landing-page Spline backdrop.
 *
 * One ambient scene behind the hero so the dark hero reads properly, the logo is
 * hidden as an asset, and the foreground (pill, headline, buttons, stats) stays
 * legible. The scene is loaded lazily, one-time per session, and is display-only
 * so pointer events on the foreground are never blocked.
 */
export const SPLINE_SCENE_URL =
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
    script.setAttribute('loading', 'lazy');
    script.setAttribute('nomodule', '');
    script.addEventListener('load', () => resolve());
    script.addEventListener('error', () =>
      reject(new Error('Spline viewer failed to load'))
    );
    document.head.append(script);
  });

  return viewerModule;
}

function sceneFallback(): React.ReactNode {
  return (
    <div
      aria-hidden="true"
      className="absolute inset-0 bg-[linear-gradient(160deg,#041713_0%,#061c18_38%,#04121c_72%,#030b10_100%)]"
    />
  );
}

export function SplineBackground({
  className,
  opacity = 0.95,
  reducedMotion = false,
  showScene = true,
  showFallback = true,
}: {
  className?: string;
  opacity?: number;
  reducedMotion?: boolean;
  showScene?: boolean;
  showFallback?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let cancelled = false;

    void loadSplineViewer().then(() => {
      if (cancelled || !hostRef.current) return;

      const viewer = document.createElement('spline-viewer');
      viewer.setAttribute('url', SPLINE_SCENE_URL);
      viewer.setAttribute('loading-anim-type', 'none');
      viewer.setAttribute('autofit', 'true');
      viewer.setAttribute('show-axis', 'false');
      viewer.setAttribute('show-grid', 'false');
      viewer.setAttribute('show-orbit', 'false');
      viewer.setAttribute('show-find-entity', 'false');
      viewer.setAttribute('background-type', 'scene');
      viewer.setAttribute('show-sun', 'false');
      viewer.setAttribute('shadow-intensity', '0');
      viewer.setAttribute('fps-limit', '30');
      viewer.setAttribute('render-quality', 'medium');
      viewer.setAttribute('show-skylight', 'false');
      viewer.setAttribute('light-intensity', '0.9');
      viewer.setAttribute('particle-count', '0');
      viewer.setAttribute('sparkle-count', '0');
      viewer.setAttribute('show-counters', 'false');
      viewer.setAttribute('show-camera-controls', 'false');
      viewer.setAttribute('show-navigate', 'false');
      viewer.setAttribute('show-animation', 'false');

      viewer.style.display = 'block';
      viewer.style.width = '100%';
      viewer.style.height = '100%';
      viewer.style.pointerEvents = 'none';
      viewer.style.position = 'absolute';
      viewer.style.inset = '0';
      viewer.style.backfaceVisibility = 'hidden';
      viewer.style.transformStyle = 'preserve-3d';

      hostRef.current.replaceChildren(viewer);

      if (reducedMotion) {
        gsap.set(viewer, { autoAlpha: 1 });
      } else {
      }
    });

    return () => {
      cancelled = true;
    };
  }, [reducedMotion]);

  const sceneContent = showScene
    ? (
      <div
        ref={hostRef}
        className="absolute inset-0 pointer-events-none mix-blend-screen"
        style={{ opacity, backfaceVisibility: 'hidden', transformStyle: 'preserve-3d' }}
      />
    )
    : null;

  return (
    <div
      aria-hidden="true"
      className={cn('pointer-events-none fixed inset-0 overflow-hidden', className)}
    >
      {showFallback ? sceneFallback() : null}
      {sceneContent}
    </div>
  );
}

/** ---------- dashboard scene (kept for /dashboard only) ---------- */

export const DASHBOARD_SPLINE_URL =
  'https://prod.spline.design/bTZSSbAPA2lktqwZ/scene.splinecode';

function dashboardSceneFallback(): React.ReactNode {
  return (
    <>
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[linear-gradient(160deg,#041713_0%,#061c18_38%,#04121c_72%,#030b10_100%)]"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_-10%,rgba(52,211,153,0.20),transparent_60%),radial-gradient(90%_70%_at_85%_110%,rgba(56,189,248,0.16),transparent_62%)]"
      />
    </>
  );
}

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
        }
      })
      .catch(() => {
        /* gradient base + scrim are the designed fallback */
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
      {dashboardSceneFallback()}
      <div
        ref={hostRef}
        className="absolute inset-0 mix-blend-screen"
        style={{ opacity }}
      />
      {scrimClassName ? (
        <div className={cn('absolute inset-0', scrimClassName)} />
      ) : null}
    </div>
  );
}
