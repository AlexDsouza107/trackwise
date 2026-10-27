import type { Metadata } from 'next';
import { Manrope } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'TrackWise',
  description: 'AICTE approval workflow automation, compliance monitoring and alert management (illustrative demo)',
};

const manrope = Manrope({ subsets: ['latin'], display: 'swap', variable: '--font-manrope' });

// Applies a pinned theme before first paint so there is no light/dark flash.
const THEME_INIT = `try{var t=localStorage.getItem('tw_theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={manrope.variable} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: THEME_INIT }} /></head>
      <body className="font-sans">{children}</body>
    </html>
  );
}
