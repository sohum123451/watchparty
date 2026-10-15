'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function JoinPage() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = code.trim().toUpperCase();
    if (!clean) {
      setError('Please enter a room code');
      return;
    }
    router.push(`/room/${encodeURIComponent(clean)}`);
  };

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

      <div className="mb-6 w-full max-w-md text-center">
        <span className="font-mono text-xs text-[#FF9F1C] uppercase tracking-widest block mb-1">
          Admission Box Office
        </span>
        <h2 className="font-display font-bold text-2xl text-[#F3E9DC]">
          Join Screening Room
        </h2>
        <p className="text-xs text-[#A89B8C] mt-1">
          Enter your room code to enter the private auditorium.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="w-full max-w-md bg-[#1A1512] border border-[#3A2E26] rounded-xl p-6 space-y-4">
        {error && (
          <div className="text-xs font-mono text-[#E4572E] bg-[#E4572E]/10 border border-[#E4572E]/30 p-2.5 rounded">
            {error}
          </div>
        )}
        <div>
          <label className="block text-xs font-mono text-[#A89B8C] uppercase tracking-wider mb-2">Room Code</label>
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="e.g. 4F7K2M"
            maxLength={12}
            className="w-full box-border bg-[#261E19] border border-[#3A2E26] rounded-lg px-4 py-3 font-mono text-lg text-center tracking-widest text-[#F3E9DC] placeholder-[#5A4A3E] focus:outline-none focus:border-[#FF9F1C]"
          />
        </div>
        <button
          type="submit"
          className="w-full py-3 bg-[#FF9F1C] hover:brightness-105 active:scale-95 text-[#0E0B09] font-bold text-sm rounded-lg transition-all border-none cursor-pointer"
        >
          Join Auditorium
        </button>
      </form>
    </div>
  );
}
