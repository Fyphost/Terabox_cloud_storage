import type { Metadata, Viewport } from 'next';
import './globals.css';
import Providers from './providers';
import Header from '@/components/layout/Header';
import MobileNav from '@/components/layout/MobileNav';

export const metadata: Metadata = {
  title: { default: 'Fyphost', template: '%s · Fyphost' },
  description: 'Stream and save TeraBox media. No ads, no fake download buttons, no throttle.',
  applicationName: 'Fyphost',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#f4f6fb',
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-bg text-fg">
        <Providers>
          <Header />
          <main className="pb-24 md:pb-12">{children}</main>
          <MobileNav />
        </Providers>
      </body>
    </html>
  );
}
