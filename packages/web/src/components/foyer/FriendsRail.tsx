'use client';

/**
 * Friends Rail Component
 * - Live presence indicators: pulse animation ONLY for live friends, steady for offline/idle
 * - Quick invite action ("Slip Ticket" / Copy room pass)
 * - Notifications styled as mini perforated cinema ticket stubs
 * - Anime.js stagger entrance on mount
 */

import React, { useState } from 'react';
import Link from 'next/link';
import { useAnime } from '@/motion/useAnime';
import { MotionDurations, MotionEasings, MotionStaggers } from '@/motion/tokens';
import { stagger } from 'animejs';

export interface FriendItem {
  id: string;
  name: string;
  avatar: string;
  status: 'live' | 'idle' | 'offline';
  currentRoom?: string;
  roomCode?: string;
}

export interface TicketNotification {
  id: string;
  fromName: string;
  roomName: string;
  roomCode: string;
  timeAgo: string;
  stubNumber: string;
}

const INITIAL_FRIENDS: FriendItem[] = [];

const INITIAL_NOTIFICATIONS: TicketNotification[] = [];

export function FriendsRail({ className = '' }: { className?: string }) {
  const [friends, setFriends] = useState(INITIAL_FRIENDS);
  const [notifications, setNotifications] = useState(INITIAL_NOTIFICATIONS);
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [activeTab, setActiveTab] = useState<'patrons' | 'tickets'>('patrons');

  // Stagger entrance on mount
  const { containerRef } = useAnime(({ animate }) => {
    animate('.rail-item', {
      opacity: [0, 1],
      translateX: [14, 0],
      delay: stagger(MotionStaggers.tight),
      duration: MotionDurations.cinematic,
      ease: MotionEasings.snappyOut,
    });
  });

  const handleQuickInvite = (friendName?: string) => {
    setCopiedInvite(true);
    setTimeout(() => setCopiedInvite(false), 2200);
  };

  const dismissNotification = (id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  return (
    <aside
      ref={containerRef}
      className={`bg-surface border border-border-brass rounded-sm shadow-velvet-raised p-4 flex flex-col justify-between ${className}`}
    >
      <div>
        {/* HEADER: Section Title & Quick Invite Trigger */}
        <div className="flex justify-between items-center pb-3 border-b border-border-brass mb-4">
          <div className="flex items-center gap-2">
            <span className="font-display font-bold text-sm text-text">Foyer Circle</span>
            <span className="text-[10px] font-mono text-accent">
              ({friends.filter((f) => f.status === 'live').length} Active)
            </span>
          </div>

          {/* Quick Invite Button */}
          <button
            onClick={() => handleQuickInvite()}
            className="px-2.5 py-1 bg-surface-2 hover:bg-surface-3 active:bg-[#0E0B09] border border-border-brass rounded-sm font-mono text-[10px] text-text hover:text-accent transition-all flex items-center gap-1.5 cursor-pointer shadow-sm"
            title="Generate and copy an admission pass to clipboard"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg>
            <span>{copiedInvite ? 'Pass Copied!' : 'Slip Ticket'}</span>
          </button>
        </div>

        {/* TABS: Patrons vs Ticket Stub Invites */}
        <div className="grid grid-cols-2 gap-1.5 p-1 bg-surface-2 border border-border-subtle rounded-sm mb-4 font-mono text-xs">
          <button
            onClick={() => setActiveTab('patrons')}
            className={`py-1 text-center rounded-[2px] transition-all ${
              activeTab === 'patrons'
                ? 'bg-accent text-bg font-bold shadow-sm'
                : 'text-muted hover:text-text'
            }`}
          >
            Patrons ({friends.length})
          </button>
          <button
            onClick={() => setActiveTab('tickets')}
            className={`py-1 text-center rounded-[2px] transition-all relative ${
              activeTab === 'tickets'
                ? 'bg-accent text-bg font-bold shadow-sm'
                : 'text-muted hover:text-text'
            }`}
          >
            Invites ({notifications.length})
            {notifications.length > 0 && (
              <span className="absolute top-1 right-2 w-1.5 h-1.5 rounded-full bg-accent-2" />
            )}
          </button>
        </div>

        {/* TAB 1: FRIENDS LIST WITH LIVE PULSE */}
        {activeTab === 'patrons' && (
          <div className="space-y-2.5">
            {friends.map((friend) => {
              const isLive = friend.status === 'live';
              const isIdle = friend.status === 'idle';

              return (
                <div
                  key={friend.id}
                  className="rail-item group p-2.5 bg-surface-2/70 hover:bg-surface-2 border border-border-subtle hover:border-border-brass rounded-sm transition-all flex items-center justify-between"
                >
                  <div className="flex items-center gap-2.5">
                    {/* Avatar with Status Dot (Pulse animation strictly only for live) */}
                    <div className="relative">
                      <div className="w-8 h-8 rounded-full bg-surface-3 border border-border-brass flex items-center justify-center font-display font-bold text-xs text-text">
                        {friend.avatar}
                      </div>

                      {/* Status Dot: Pulse ONLY for live */}
                      <span
                        className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border border-bg ${
                          isLive
                            ? 'bg-live shadow-cathode animate-cathode-pulse' // Pulsing cathode beacon
                            : isIdle
                            ? 'bg-accent' // Steady non-pulsing amber
                            : 'bg-muted-dark' // Steady non-pulsing gray
                        }`}
                      />
                    </div>

                    <div>
                      <div className="text-xs font-semibold text-text group-hover:text-accent transition-colors flex items-center gap-1.5">
                        <span>{friend.name}</span>
                        {isLive && (
                          <span className="text-[9px] font-mono text-live font-normal uppercase">
                            &bull; Screening
                          </span>
                        )}
                      </div>
                      <div className="font-mono text-[10px] text-muted truncate max-w-[130px]">
                        {friend.currentRoom || 'In Foyer Lounge'}
                      </div>
                    </div>
                  </div>

                  {/* Quick Action: Join suite if live, or Slip Ticket */}
                  {isLive && friend.roomCode ? (
                    <Link
                      href={`/join/${friend.roomCode}`}
                      className="px-2 py-0.5 bg-accent/15 hover:bg-accent text-accent hover:text-bg font-mono text-[10px] font-bold rounded-sm border border-border-brass-bright transition-all"
                    >
                      Join
                    </Link>
                  ) : (
                    <button
                      onClick={() => handleQuickInvite(friend.name)}
                      className="opacity-0 group-hover:opacity-100 px-2 py-0.5 bg-surface-3 hover:bg-surface text-muted hover:text-text font-mono text-[10px] rounded-sm border border-border-subtle transition-all cursor-pointer"
                      title="Slip an invite ticket"
                    >
                      Invite
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* TAB 2: NOTIFICATIONS AS MINI PERFORATED TICKET STUBS */}
        {activeTab === 'tickets' && (
          <div className="space-y-3">
            {notifications.length === 0 ? (
              <div className="text-center py-8 text-xs font-mono text-muted-dark">
                No tickets in your collection.
              </div>
            ) : (
              notifications.map((notif) => (
                <div
                  key={notif.id}
                  className="rail-item relative bg-[#201813] border border-border-brass rounded-sm overflow-hidden p-3 shadow-velvet-raised"
                >
                  {/* Perforation Semicircle Cutouts */}
                  <div className="absolute top-1/2 -left-2 -translate-y-1/2 w-4 h-4 rounded-full bg-surface border border-border-brass" />
                  <div className="absolute top-1/2 -right-2 -translate-y-1/2 w-4 h-4 rounded-full bg-surface border border-border-brass" />

                  {/* Header */}
                  <div className="flex justify-between items-center text-[10px] font-mono text-accent pl-1.5 pr-1.5 mb-1">
                    <span className="uppercase tracking-widest">INVITE PASS</span>
                    <span className="text-muted-dark">#{notif.stubNumber}</span>
                  </div>

                  {/* Body */}
                  <div className="pl-1.5 pr-1.5 my-2">
                    <div className="font-display font-bold text-xs text-text leading-tight">
                      {notif.roomName}
                    </div>
                    <div className="text-[11px] text-muted mt-0.5">
                      From <span className="text-text font-medium">{notif.fromName}</span>
                    </div>
                  </div>

                  {/* Dashed Tear Line */}
                  <div className="border-t border-dashed border-border-brass my-2" />

                  {/* Actions */}
                  <div className="flex justify-between items-center pl-1.5 pr-1.5 text-xs">
                    <span className="font-mono text-[9px] text-muted-dark">{notif.timeAgo}</span>
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => dismissNotification(notif.id)}
                        className="px-2 py-0.5 text-muted hover:text-text font-mono text-[10px]"
                      >
                        Pass
                      </button>
                      <Link
                        href={`/join/${notif.roomCode}`}
                        className="px-2.5 py-0.5 bg-accent hover:bg-[#FFAE38] text-bg font-bold font-mono text-[10px] rounded-sm transition-all shadow-sm"
                      >
                        Accept
                      </Link>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* FOOTER: Foyer Security Beacon */}
      <div className="pt-4 border-t border-border-subtle flex items-center justify-between text-[10px] font-mono text-muted-dark">
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-live" />
          <span>E2EE Presence Mesh</span>
        </span>
        <span>0.1ms SYNC</span>
      </div>
    </aside>
  );
}
