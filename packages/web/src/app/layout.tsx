import type { Metadata } from 'next';
import { Fraunces, Bricolage_Grotesque, DM_Sans, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { PageTransition } from '@/motion/PageTransition';

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

export const metadata: Metadata = {
  title: 'Watch Party — The Private Cinema',
  description: 'Ultra-low latency co-watching in a warm, dark, tactile theatre atmosphere.',
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
        {/* Ambient Overhead Projector Cone */}
        <div className="projector-beam-ambient" />

        {/* Global Page Transition Wrapper */}
        <PageTransition className="relative z-10 min-h-screen flex flex-col">
          {children}
        </PageTransition>
      </body>
    </html>
  );
}
