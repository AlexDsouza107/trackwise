'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { getStoredUser } from '@/lib/api';

export default function Home() {
  const router = useRouter();
  useEffect(() => { router.replace(getStoredUser() ? '/applications' : '/login'); }, [router]);
  return null;
}
