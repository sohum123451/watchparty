import React from 'react';
import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-[#0E0B09] text-[#F3E9DC] flex flex-col items-center justify-center p-6 text-center">
      <div className="font-mono text-xs uppercase tracking-widest text-[#FF9F1C] mb-2">
        404 — Cinema Archive
      </div>
      <h1 className="font-serif text-3xl md:text-4xl font-normal text-[#F3E9DC] mb-4">
        Reel Not Found
      </h1>
      <p className="font-sans text-sm text-[#F3E9DC]/70 max-w-md mb-8">
        The screening room or feature you are looking for has concluded or does not exist.
      </p>
      <Link
        href="/lobby"
        className="px-6 py-3 rounded-full bg-[#E4572E] text-[#0E0B09] font-medium font-sans text-sm hover:brightness-110 transition-all shadow-[0_0_24px_rgba(228,87,46,0.35)]"
      >
        Return to Lobby
      </Link>
    </div>
  );
}
