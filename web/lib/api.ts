'use client';
import { useCallback, useEffect, useState } from 'react';
import type { User } from './types';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

const TOKEN_KEY = 'tw_token';
const USER_KEY = 'tw_user';

export function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function getStoredUser(): User | null {
  try { const raw = localStorage.getItem(USER_KEY); return raw ? (JSON.parse(raw) as User) : null; } catch { return null; }
}
export function storeSession(token: string, user: User): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}
export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set('authorization', `Bearer ${token}`);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(init.json);
  }
  const res = await fetch(`${API_URL}${path}`, { ...init, headers, body });
  if (res.status === 401 && typeof window !== 'undefined' && !path.startsWith('/auth/login')) {
    clearSession();
    window.location.href = '/login';
  }
  if (!res.ok) {
    let message = res.statusText;
    try { const j = await res.json(); message = Array.isArray(j.message) ? j.message.join('; ') : j.message ?? message; } catch { /* non-JSON error body */ }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}

export async function fetchBlobUrl(path: string): Promise<string> {
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new ApiError(res.status, 'Could not load document');
  return URL.createObjectURL(await res.blob());
}

export function useApi<T>(path: string | null, pollMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);

  const load = useCallback(async () => {
    if (!path) return;
    try { setData(await api<T>(path)); setError(null); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [path]);

  useEffect(() => {
    setLoading(!!path);
    void load();
    if (!pollMs) return;
    const t = setInterval(load, pollMs);
    return () => clearInterval(t);
  }, [load, path, pollMs]);

  return { data, error, loading, reload: load, setData };
}
