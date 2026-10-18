import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import { Fraunces, Bricolage_Grotesque, DM_Sans, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { PageTransition } from '@/motion/PageTransition';
import { AuthProvider } from '@/lib/AuthContext';

const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  display: 'swap',
});

const bricolage = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-bricolage',
  display: 'swap',
});

const dmSans = DM_Sans({
  subsets: ['latin'],
  variable: '--font-dm-sans',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

import { CurtainWipe } from '@/motion/CurtainWipe';
import { InstallAppBanner } from '@/components/InstallAppBanner';

export const viewport: Viewport = {
  themeColor: '#0E0B09',
  colorScheme: 'dark',
  viewportFit: 'cover',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export const metadata: Metadata = {
  title: 'Watch Party — The Private Cinema',
  description: 'Ultra-low latency co-watching in a warm, dark, tactile theatre atmosphere. Projector light, velvet, and friends sharing the exact same frame down to the millisecond.',
  keywords: ['watch party', 'cinema', 'synchronized video', '70mm', 'theatre', 'film grain'],
  authors: [{ name: 'Watch Party Cinematheque' }],
  manifest: '/manifest.json',
  icons: {
    icon: '/icon-192.svg',
    apple: '/icon-192.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'WatchParty',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${bricolage.variable} ${dmSans.variable} ${jetbrainsMono.variable} dark`}
    >
      <body className="bg-bg text-text font-ui antialiased min-h-screen cinema-grain">
        {/* Theatrical Velvet Curtain Wipe Layer (Skippable, < 800ms) */}
        <CurtainWipe />

        {/* Ambient Overhead Projector Cone */}
        <div className="projector-beam-ambient" />

        {/* Global Page Transition Wrapper */}
        <AuthProvider>
          <PageTransition className="relative z-10 min-h-screen flex flex-col">
            {children}
          </PageTransition>
        </AuthProvider>

        {/* PWA Physical Ticket Pass Banner */}
        <InstallAppBanner />

        <Script src="https://accounts.google.com/gsi/client" strategy="lazyOnload" />
      </body>
    </html>
  );
}
