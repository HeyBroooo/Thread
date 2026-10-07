'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';

export function SessionControls() {
  const pathname = usePathname();
  const isLoginPage = pathname === '/login';
  const router = useRouter();
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    void api.authSession()
      .then((session) => setAuthenticated(session.authenticated))
      .catch(() => setAuthenticated(false));
  }, [isLoginPage]);

  if (!authenticated || isLoginPage) return null;

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
    <Button
      type="button"
      onClick={() => void signOut()}
      variant="outline"
      size="sm"
      style={{ position: 'fixed', top: 14, right: 16, zIndex: 100 }}
    >
      Sign out
    </Button>
  );
}
