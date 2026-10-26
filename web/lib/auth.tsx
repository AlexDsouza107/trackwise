'use client';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { clearSession, getStoredUser, getToken } from './api';
import type { User } from './types';

const AuthCtx = createContext<User | null>(null);
export const useUser = () => useContext(AuthCtx)!;

/** Client-side guard: renders children only once a session exists. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const u = getStoredUser();
    if (!u || !getToken()) { clearSession(); router.replace('/login'); return; }
    setUser(u); setChecked(true);
  }, [router]);

  if (!checked || !user) return null;
  return <AuthCtx.Provider value={user}>{children}</AuthCtx.Provider>;
}

export const isStaff = (u: User) => u.role !== 'institution';
export function usePathStartsWith(prefix: string) { return usePathname().startsWith(prefix); }
