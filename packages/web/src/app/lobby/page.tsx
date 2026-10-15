'use client';

/**
 * Cinema Foyer / Lobby Page
 * Matched to approved Private Cinema reference frame.
 * Tokens: bg #0E0B09, surface #1A1512, surface-2 #261E19, line #3A2E26, text #F3E9DC, muted #A89B8C, amber #FF9F1C, red #E4572E, teal #2EC4B6.
 * Typography: Fraunces (display), DM Sans (UI), JetBrains Mono (codes).
 * Flat colour blocks, no gradients, no emojis.
 */

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface Friend {
  id: string;
  name: string;
  avatar: string;
  avatarBg: string;
  avatarColor: string;
  status: 'Watching' | 'Listening' | 'Online' | 'Offline';
  liveDot?: string;
}

const FRIENDS_LIST: Friend[] = [
  {
    id: 'f1',
    name: 'Priya',
    avatar: 'P',
    avatarBg: '#E4572E',
    avatarColor: '#0E0B09',
    status: 'Watching',
    liveDot: '#2EC4B6',
  },
  {
    id: 'f2',
    name: 'Sam',
    avatar: 'S',
    avatarBg: '#2EC4B6',
    avatarColor: '#0E0B09',
    status: 'Listening',
    liveDot: '#2EC4B6',
  },
  {
    id: 'f3',
    name: 'Meera',
    avatar: 'M',
    avatarBg: '#F3E9DC',
    avatarColor: '#0E0B09',
    status: 'Online',
    liveDot: '#2EC4B6',
  },
  {
    id: 'f4',
    name: 'Rohan',
    avatar: 'R',
    avatarBg: '#5A4A3E',
    avatarColor: '#F3E9DC',
    status: 'Offline',
    liveDot: '#5A4A3E',
  },
];

const TONIGHT_PICKS = [
  {
    id: 'p1',
    title: 'Elephants Dream',
    bg: '#1A1512',
    color: '#F3E9DC',
    border: '1px solid #3A2E26',
    code: 'ELEPHANTS',
  },
  {
    id: 'p2',
    title: 'Sintel',
    bg: '#2EC4B6',
    color: '#0E0B09',
    border: 'none',
    code: 'SINTEL',
  },
  {
    id: 'p3',
    title: 'Nosferatu',
    bg: '#F3E9DC',
    color: '#0E0B09',
    border: 'none',
    code: 'NOSFERATU',
  },
  {
    id: 'p4',
    title: 'Tears of Steel',
    bg: '#FF9F1C',
    color: '#0E0B09',
    border: 'none',
    code: 'TEARS-STEEL',
  },
  {
    id: 'p5',
    title: 'A Trip to the Moon',
    bg: '#261E19',
    color: '#F3E9DC',
    border: 'none',
    code: 'MOON-1902',
  },
];

export default function LobbyPage() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [friendModalOpen, setFriendModalOpen] = useState(false);
  const [friendCode, setFriendCode] = useState('');

  const filteredPicks = TONIGHT_PICKS.filter((pick) =>
    pick.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="min-h-screen box-border bg-[#0E0B09] text-[#F3E9DC] font-ui pb-12">
      {/* HEADER */}
      <header className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 px-6 sm:px-12 md:px-16 py-7">
        <Link
          href="/"
          className="flex items-center gap-3 font-display italic font-medium text-2xl sm:text-[28px] text-[#F3E9DC] hover:text-[#FF9F1C] transition-colors"
        >
          <span className="w-3.5 h-3.5 rounded-full bg-[#FF9F1C] inline-block flex-shrink-0" />
          <span>Watch Party</span>
        </Link>

        {/* Search Input */}
        <div className="flex-1 max-w-md mx-0 sm:mx-6">
          <input
            type="text"
            aria-label="Search"
            placeholder="Search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full box-border bg-[#1A1512] border border-[#3A2E26] rounded-xl px-4.5 py-3.5 text-[#F3E9DC] text-base font-ui placeholder-[#A89B8C] focus:outline-none focus:border-[#FF9F1C] transition-colors"
          />
        </div>

        {/* User Avatar Circle */}
        <div className="flex items-center justify-end gap-3.5 text-[15px] text-[#A89B8C]">
          <Link
            href="/login"
            className="w-10 h-10 rounded-full bg-[#FF9F1C] flex items-center justify-center font-bold text-[#0E0B09] hover:brightness-105 transition-all"
            title="Profile"
          >
            A
          </Link>
        </div>
      </header>

      {/* MAIN CONTAINER */}
      <div className="flex flex-col lg:flex-row gap-8 px-6 sm:px-12 md:px-16 pt-3">
        {/* Left Column: Now Showing & Tonight's Picks */}
        <div className="flex-1 min-w-0">
          {/* NOW SHOWING HEADER */}
          <div className="flex items-baseline gap-4">
            <h2 className="m-0 font-display font-semibold text-3xl sm:text-[44px] text-[#F3E9DC]">
              Now showing
            </h2>
          </div>

          {/* NOW SHOWING TILES */}
          <div className="flex flex-col md:flex-row gap-5 mt-5">
            {/* Hero Tile: Big Buck Bunny */}
            <div className="flex-[2] min-h-[280px] sm:h-[300px] box-border bg-[#E4572E] text-[#0E0B09] rounded-[20px] p-6 sm:p-7 flex flex-col justify-between">
              <div className="font-mono text-xs sm:text-[13px] tracking-[0.12em] font-medium text-[#0E0B09]">
                LIVE
              </div>
              <div className="font-display font-semibold text-4xl sm:text-6xl md:text-[68px] leading-[0.98] tracking-[-0.02em] text-[#0E0B09] my-3">
                Big Buck Bunny
              </div>
              <div className="flex items-center justify-between">
                <span className="text-base text-[#0E0B09] font-medium">Priya</span>
                <Link
                  href="/room/RM-4F7K"
                  className="bg-[#0E0B09] text-[#F3E9DC] hover:text-[#FF9F1C] font-bold text-sm sm:text-base px-6 py-3 rounded-full transition-colors inline-block"
                >
                  Join room
                </Link>
              </div>
            </div>

            {/* Right Stack: Podcast Night & Sintel */}
            <div className="flex-1 flex flex-col gap-5">
              <Link
                href="/room/PODCAST-01"
                className="flex-1 bg-[#261E19] hover:bg-[#2F2520] transition-colors rounded-[20px] p-5.5 flex flex-col justify-between min-h-[135px]"
              >
                <div className="font-mono text-xs tracking-[0.12em] text-[#2EC4B6]">
                  LIVE
                </div>
                <div className="mt-2.5 font-display font-semibold text-2xl sm:text-[28px] leading-[1.1] text-[#F3E9DC]">
                  Podcast night
                </div>
              </Link>
              <Link
                href="/room/SINTEL-4K"
                className="flex-1 bg-[#261E19] hover:bg-[#2F2520] transition-colors rounded-[20px] p-5.5 flex flex-col justify-between min-h-[135px]"
              >
                <div className="font-mono text-xs tracking-[0.12em] text-[#A89B8C]">
                  9 PM
                </div>
                <div className="mt-2.5 font-display font-semibold text-2xl sm:text-[28px] leading-[1.1] text-[#F3E9DC]">
                  Sintel
                </div>
              </Link>
            </div>
          </div>

          {/* TONIGHT'S PICKS HEADER */}
          <div className="flex items-center gap-5 mt-10 mb-4">
            <h2 className="m-0 font-display font-semibold text-2xl sm:text-[34px] text-[#F3E9DC]">
              Tonight’s picks
            </h2>
            <span className="bg-[#FF9F1C] text-[#0E0B09] font-bold text-sm px-4 py-2 rounded-full">
              Free
            </span>
          </div>

          {/* TONIGHT'S PICKS 5 CARDS */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4.5">
            {filteredPicks.map((pick) => (
              <Link
                key={pick.id}
                href={`/room/${pick.code}`}
                style={{
                  backgroundColor: pick.bg,
                  color: pick.color,
                  border: pick.border,
                }}
                className="h-[250px] box-border rounded-[16px] p-4.5 flex flex-col justify-end hover:scale-[1.02] active:scale-[0.98] transition-transform"
              >
                <div className="font-display font-semibold text-xl sm:text-[28px] leading-[1.05]">
                  {pick.title}
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* RIGHT COLUMN: FRIENDS SIDEBAR (300px) */}
        <aside className="w-full lg:w-[300px] box-border self-start bg-[#1A1512] rounded-[20px] p-6 flex-shrink-0">
          <div className="flex items-baseline justify-between">
            <h3 className="m-0 font-display font-semibold text-2xl sm:text-[28px] text-[#F3E9DC]">
              Friends
            </h3>
          </div>

          {/* Friends List with strictly 1-word statuses */}
          <div className="mt-4">
            {FRIENDS_LIST.map((friend) => (
              <div
                key={friend.id}
                className="flex items-center gap-3 py-3.5 border-t border-[#2A211B] first:border-t-0"
              >
                <span
                  style={{
                    backgroundColor: friend.avatarBg,
                    color: friend.avatarColor,
                  }}
                  className="relative w-[38px] h-[38px] rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0"
                >
                  {friend.avatar}
                  <span
                    style={{ backgroundColor: friend.liveDot }}
                    className="absolute -right-0.5 -bottom-0.5 w-3 h-3 rounded-full border-2 border-[#1A1512]"
                  />
                </span>
                <div>
                  <div className="font-bold text-[15px] text-[#F3E9DC]">{friend.name}</div>
                  <div className="text-[13px] text-[#A89B8C]">{friend.status}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Add Friend Button & Modal */}
          {!friendModalOpen ? (
            <button
              type="button"
              onClick={() => setFriendModalOpen(true)}
              className="w-full mt-3 text-center border-[1.5px] border-[#5A4A3E] hover:border-[#FF9F1C] hover:text-[#FF9F1C] text-[#F3E9DC] rounded-full py-3 text-[15px] transition-colors cursor-pointer"
            >
              Add friend
            </button>
          ) : (
            <div className="mt-3 flex gap-2">
              <input
                type="text"
                placeholder="Username"
                value={friendCode}
                onChange={(e) => setFriendCode(e.target.value)}
                autoFocus
                className="flex-1 bg-[#261E19] border border-[#3A2E26] rounded-full px-3.5 py-2 text-xs text-[#F3E9DC] focus:outline-none focus:border-[#FF9F1C]"
              />
              <button
                type="button"
                onClick={() => {
                  setFriendModalOpen(false);
                  setFriendCode('');
                }}
                className="bg-[#FF9F1C] text-[#0E0B09] font-bold text-xs px-3 py-2 rounded-full"
              >
                Add
              </button>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
