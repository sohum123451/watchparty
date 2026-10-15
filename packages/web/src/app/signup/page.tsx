import React from 'react';
import Link from 'next/link';
import { TicketBoothAuth } from '@/components/TicketBoothAuth';

export const metadata = {
  title: 'Box Office & Ticket Admission — Watch Party',
  description: 'Claim your admission pass to unlock private cinema rooms with friends.',
};

export default function SignupPage() {
  return (
    <div className="min-h-[85vh] flex flex-col items-center justify-center px-4 py-12">
      <div className="mb-6 text-center">
        <Link
          href="/"
          className="font-mono text-xs text-muted hover:text-accent transition-colors"
        >
          ← Return to Grand Foyer
        </Link>
      </div>

      <TicketBoothAuth initialMode="signup" />
    </div>
  );
}
