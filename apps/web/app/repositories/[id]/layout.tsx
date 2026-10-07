import type { ReactNode } from 'react';
import { RepositoryLayout } from '@/components/RepositoryLayout';

export default function RepositoryRouteLayout({ children }: { children: ReactNode }) {
  return <RepositoryLayout>{children}</RepositoryLayout>;
}
