import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { SessionControls } from '@/components/SessionControls';
import { SplineBackground } from '@/components/SplineBackground';
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
        <SplineBackground />
        {children}
        <SessionControls />
      </body>
    </html>
  );
}
