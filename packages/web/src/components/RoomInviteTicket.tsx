'use client';

/**
 * Room Invite Ticket Component with Animated Stub-Tear on Join
 * Displays the room's authentic physical ticket:
 * - Room name, host with projectionist badge, and stacked avatars of who is inside.
 * - On join action, animates a crisp tactile stub-tear separation via anime.js v4.
 */

import React, { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { FilmReelSpinner } from './FilmReelSpinner';
import { useAnime } from '@/motion/useAnime';
import { MotionDurations, MotionEasings } from '@/motion/tokens';
import { triggerCurtainWipe } from '@/motion/CurtainWipe';
import { animate } from 'animejs';

export interface RoomInviteDetails {
  roomCode: string;
  roomName: string;
  hostName: string;
  mediaTitle: string;
  mediaFormat?: string;
  memberCount: number;
  members: Array<{ id: string; name: string; avatar: string; isHost?: boolean }>;
}

export function RoomInviteTicket({
  invite,
}: {
  invite?: Partial<RoomInviteDetails>;
}) {
  const router = useRouter();
  const [userName, setUserName] = useState('');
  const [joining, setJoining] = useState(false);
  const [admitted, setAdmitted] = useState(false);

  const ticketRef = useRef<HTMLDivElement>(null);
  const stubRightRef = useRef<HTMLDivElement>(null);
  const seamFlashRef = useRef<HTMLDivElement>(null);

  const room = {
    roomCode: invite?.roomCode || '',
    roomName: invite?.roomName || (invite?.roomCode ? `Room ${invite.roomCode}` : 'Screening Room'),
    hostName: invite?.hostName || 'Host',
    mediaTitle: invite?.mediaTitle || 'Synchronized Screening',
    mediaFormat: invite?.mediaFormat || 'Direct Master',
    memberCount: invite?.memberCount || 1,
    members: invite?.members || [],
  };

  const handleTearAndJoin = () => {
    if (joining || admitted) return;
    setJoining(true);

    if (stubRightRef.current && seamFlashRef.current) {
      // 1. Perforation tear flash
      animate(seamFlashRef.current, {
        opacity: [0, 1, 0],
        duration: 200,
        ease: 'linear',
      });

      // 2. Physical stub tear translation & rotation
      animate(stubRightRef.current, {
        translateX: [0, 52],
        translateY: [0, 16],
        rotate: [0, 5.5],
        duration: MotionDurations.cinematic,
        ease: MotionEasings.springy,
      });

      // 3. Stub drops down into ticket collector box
      setTimeout(() => {
        if (stubRightRef.current) {
          animate(stubRightRef.current, {
            translateY: [16, 44],
            opacity: [1, 0.2],
            duration: 400,
            ease: MotionEasings.cinematicInOut,
          });
        }
      }, 350);
    }

    // After animation, simulate entry into theatre auditorium with curtain wipe
    setTimeout(() => {
      setAdmitted(true);
      setTimeout(() => {
        triggerCurtainWipe(() => {
          router.push(`/room/${encodeURIComponent(room.roomCode)}`);
        });
      }, 650);
    }, 850);
  };

  return (
    <div className="w-full max-w-2xl mx-auto p-4">
      {/* TICKET CONTAINER WITH PHYSICAL SEAM */}
      <div
        ref={ticketRef}
        className="relative bg-surface border-2 border-border-brass rounded-sm shadow-velvet-raised overflow-hidden filter drop-shadow-[0_12px_32px_rgba(0,0,0,0.85)] flex flex-col md:flex-row"
      >
        {/* TICKET BODY (LEFT 70%) */}
        <div className="flex-1 p-5 md:p-8 flex flex-col justify-between border-b md:border-b-0 md:border-r border-border-brass relative">
          <div>
            {/* Header / Room Code */}
            <div className="flex justify-between items-center text-xs font-mono text-accent mb-3">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-live shadow-cathode animate-pulse" />
                <span className="tracking-widest uppercase">NOW SHOWING</span>
              </div>
              <span className="border border-dashed border-border-brass px-2 py-0.5 rounded text-[11px]">
                {room.roomCode}
              </span>
            </div>

            {/* Room Title */}
            <h1 className="font-display font-bold text-2xl md:text-3xl text-text leading-tight mb-2">
              {room.mediaTitle}
            </h1>

            {/* Auditorium & Host Tag */}
            <div className="flex flex-wrap items-center gap-3 mb-6 text-xs">
              <span className="text-text font-medium">{room.roomName}</span>
              <span className="text-muted-dark">&bull;</span>
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-accent/15 border border-border-brass-bright rounded-sm font-mono text-accent text-[11px] font-bold">
                Host: {room.hostName}
              </span>
            </div>

            {/* WHO IS INSIDE: STACKED AVATARS */}
            <div className="p-3 bg-surface-2 border border-border-subtle rounded-sm mb-6">
              <div className="flex justify-between items-center text-xs font-mono text-muted mb-2">
                <span>Who&apos;s Inside</span>
                <span className="text-live">{room.memberCount} inside</span>
              </div>

              <div className="flex items-center gap-2">
                <div className="flex -space-x-2 overflow-hidden">
                  {room.members.map((member) => (
                    <div
                      key={member.id}
                      title={member.name + (member.isHost ? ' (Host)' : '')}
                      className="inline-block h-8 w-8 rounded-full ring-2 ring-surface bg-surface-3 border border-border-brass flex items-center justify-center font-display font-bold text-xs text-text relative"
                    >
                      {member.avatar}
                      {member.isHost && (
                        <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-accent border border-bg" />
                      )}
                    </div>
                  ))}
                </div>
                <span className="text-xs text-muted font-sans ml-2">
                  Elena, Marcus, and 2 others waiting
                </span>
              </div>
            </div>

            {/* Guest Name Input */}
            <div className="mb-2">
              <label className="block text-xs font-mono text-muted uppercase tracking-wider mb-1">
                Name
              </label>
              <input
                type="text"
                placeholder="e.g. Leo (Guest)"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                className="w-full bg-surface-2 border border-border-brass rounded-sm px-3.5 py-2 text-sm text-text placeholder-muted-dark focus:border-accent focus:shadow-projector outline-none transition-all shadow-velvet-inset"
              />
            </div>
          </div>

          {/* Footer Metadata */}
          <div className="pt-4 border-t border-border-subtle flex justify-between items-center text-[10px] font-mono text-muted-dark">
            <span>{room.mediaFormat}</span>
            <span>CLOCK DRIFT: 0.08ms</span>
          </div>

          {/* Semicircular Cutout Notch (Right Edge of Left Half) */}
          <div className="hidden md:block absolute top-1/2 -right-3 -translate-y-1/2 w-6 h-6 rounded-full bg-bg border border-border-brass pointer-events-none z-10" />
        </div>

        {/* PERFORATION FLASH EFFECT */}
        <div
          ref={seamFlashRef}
          className="hidden md:block absolute right-52 top-0 bottom-0 w-1.5 bg-accent/90 opacity-0 pointer-events-none blur-[1px] z-20"
        />

        {/* TICKET STUB TEAR-OFF (RIGHT 30%) */}
        <div
          ref={stubRightRef}
          className="w-full md:w-52 p-4 md:p-6 bg-surface-2 flex flex-col justify-between items-center text-center relative border-t md:border-t-0 border-dashed border-border-brass origin-top-left"
        >
          {/* Semicircular Cutout Notch (Left Edge of Right Stub on Desktop) */}
          <div className="hidden md:block absolute top-1/2 -left-3 -translate-y-1/2 w-6 h-6 rounded-full bg-bg border border-border-brass pointer-events-none z-10" />

          {/* Semicircular Cutout Notch (Top Seam on Mobile) */}
          <div className="md:hidden absolute -top-3 left-1/2 -translate-x-1/2 w-6 h-6 rounded-full bg-bg border border-border-brass pointer-events-none z-10" />

          <div className="w-full">
            <span className="font-mono text-[10px] text-accent tracking-widest uppercase block mb-1">
              ADMIT ONE
            </span>
            <span className="font-display font-bold text-sm text-text block">
              BALCONY PASS
            </span>
            <span className="font-mono text-[9px] text-muted-dark block mt-1">
              STUB #{room.roomCode}
            </span>
          </div>

          {/* Barcode Graphic */}
          <div className="flex gap-1.5 h-8 sm:h-12 my-3 sm:my-6 items-stretch opacity-80">
            <div className="w-1 bg-muted" />
            <div className="w-2 bg-muted" />
            <div className="w-0.5 bg-muted" />
            <div className="w-1.5 bg-muted" />
            <div className="w-1 bg-muted" />
            <div className="w-2.5 bg-muted" />
            <div className="w-0.5 bg-muted" />
            <div className="w-1.5 bg-muted" />
          </div>

          {/* ACTION BUTTON WITH TEAR TRIGGER */}
          <div className="w-full">
            <button
              onClick={handleTearAndJoin}
              disabled={joining || admitted}
              className="w-full py-3 px-4 bg-accent hover:bg-[#FFAE38] active:bg-[#E6880C] text-[#0E0B09] font-display font-bold text-xs tracking-wider uppercase rounded-sm transition-all shadow-projector flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
            >
              {joining ? (
                <FilmReelSpinner size="sm" />
              ) : admitted ? (
                <span>Admitted!</span>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg>
                  <span>Join</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
