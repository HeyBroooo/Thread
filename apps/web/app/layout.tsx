import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { SplineBackground, DashboardSplineBackground } from '@/components/SplineBackground';
import { SessionControls } from '@/components/SessionControls';
import './globals.css';
import './tailwind.css';

export const metadata: Metadata = {
  title: 'Codebase Intelligence',
  description:
    'A persistent, evidence-backed knowledge graph of your repository powering a codebase canvas, grounded chat and context-aware PR review.',
  icons: {
    icon: '/logo-128.png',
    shortcut: '/logo-128.png',
    apple: '/logo-512.png',
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* Landing and dashboard share the same scene source, but the landing page
        imports its own SplineBackground so the logo is hidden there. */}
        {typeof window !== 'undefined' && !window.location.pathname.startsWith('/dashboard')
          ? null
          : <DashboardSplineBackground />}
        {children}
        <SessionControls />
      </body>
    </html>
  );
}
