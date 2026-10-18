import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { AuthProvider } from '@/lib/auth';
import { APP_NAME, APP_TAGLINE } from '@/lib/brand';
import './globals.css';

export const metadata: Metadata = {
  title: { default: `${APP_NAME}: ${APP_TAGLINE}`, template: `%s | ${APP_NAME}` },
  description:
    'Upload your resume and talk with an AI interviewer that starts with the basics and works up to the hard questions.',
};

export const viewport: Viewport = {
  themeColor: '#edefea',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..900&family=Source+Serif+4:ital,opsz,wght@0,8..60,400..700;1,8..60,400..700&display=swap"
        />
      </head>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
