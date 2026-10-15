'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { LogOut, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * `floating` pins the control to the viewport corner — used on the landing and
 * login pages. `inline` renders it in normal flow, which is what the repository
 * header uses so it can never cover the tab bar.
 */
export function SessionControls({ variant = 'floating' }: { variant?: 'floating' | 'inline' } = {}) {
  const pathname = usePathname();
  const isLoginPage = pathname === '/login';
  const isRepoPage = pathname.startsWith('/repositories/');
  const router = useRouter();
  const [authenticated, setAuthenticated] = useState(false);
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    void api.authSession()
      .then((session) => {setAuthenticated(session.authenticated);setEmail(session.email ?? '');})
      .catch(() => setAuthenticated(false));
  }, [isLoginPage]);

  if (!authenticated || isLoginPage) return null;
  // The floating copy stands down on repository routes, where RepoShell renders
  // the inline one inside the header instead.
  if (variant === 'floating' && isRepoPage) return null;

  async function signOut() {
    try {
      await api.logout();
      router.replace('/login');
      router.refresh();
    } catch {
      setError('Could not sign out. Please try again.');
    }
  }

  return (
    <div className={`session-controls ${variant}`}>
      {error && <span role="alert" className="text-xs text-destructive">{error}</span>}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="session-controls-trigger">
            <ShieldCheck aria-hidden="true" />
            Workspace
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuLabel>{email || 'Your account'}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => void signOut()}>
            <LogOut aria-hidden="true" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
