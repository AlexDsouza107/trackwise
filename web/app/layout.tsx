import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'TrackWise',
  description: 'AICTE approval workflow automation, compliance monitoring and alert management (illustrative demo)',
};

// Applies a pinned theme before first paint so there is no light/dark flash.
const THEME_INIT = `try{var t=localStorage.getItem('tw_theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: THEME_INIT }} /></head>
      <body className="font-sans">{children}</body>
    </html>
  );
}
