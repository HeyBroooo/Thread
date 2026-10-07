'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { api } from '@/lib/api';

export function SessionControls() {
  const pathname = usePathname();
  const router = useRouter();
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    void api.authSession()
      .then((session) => setAuthenticated(session.authenticated))
      .catch(() => setAuthenticated(false));
  }, [pathname]);

  if (!authenticated || pathname === '/login') return null;

  async function signOut() {
    try {
      await api.logout();
      router.replace('/login');
      router.refresh();
    } catch {
      window.location.assign('/login');
    }
  }

  return (
    <button
      type="button"
      onClick={() => void signOut()}
      style={{ position: 'fixed', top: 14, right: 16, zIndex: 100 }}
    >
      Sign out
    </button>
  );
}
