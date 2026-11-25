'use client';

import '@/frontend/globals.css';
import { SessionProvider } from 'next-auth/react';
import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const path = usePathname();
  const staging = path === '/staging' || path?.startsWith('/staging/');
  return (
    <html lang="en">
      <body>
        {staging ? children : <SessionProvider>{children}</SessionProvider>}
      </body>
    </html>
  );
}
