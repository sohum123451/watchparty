'use client';

/**
 * TheatreSidebar Component
 * Aligned to approved reference frame:
 * 1. 3 Tabs: Chat, Queue, Polls
 * 2. Chat without timestamps
 * 3. Flat color tokens & DM Sans font
 * 4. Animated queue and poll reordering preserved
 */

import React, { useState, useRef, useEffect } from 'react';

export type TheatreTab = 'chat' | 'queue' | 'polls';

export interface ChatEntry {
  id: string;
  senderName: string;
  senderColor: string;
  text: string;
}

export interface PlaylistItemEntry {
  id: string;
  title: string;
  year?: number;
  votes: number;
  isPlaying?: boolean;
}

export interface PollOptionEntry {
  id: string;
  text: string;
  votes: number;
}

export interface TheatreSidebarProps {
  isOpen: boolean;
  onClose?: () => void;
  isMobileSheet?: boolean;
  speakingMembers?: string[];
  onToggleUserSpeaking?: () => void;
  isUserSpeaking?: boolean;
  currentRoomCode?: string;
  className?: string;
}

const INITIAL_MESSAGES: ChatEntry[] = [
  {
    id: 'c1',
    senderName: 'Priya',
    senderColor: '#FF9F1C',
    text: 'best scene',
  },
  {
    id: 'c2',
    senderName: 'Sam',
    senderColor: '#2EC4B6',
    text: 'wait, what did I miss?',
  },
  {
    id: 'c3',
    senderName: 'Aarav',
    senderColor: '#E4572E',
    text: 'you’re good',
  },
];

const INITIAL_QUEUE: PlaylistItemEntry[] = [
  {
    id: 'pl_1',
    title: 'Big Buck Bunny',
    year: 2008,
    votes: 12,
    isPlaying: true,
  },
  {
    id: 'pl_2',
    title: 'Sintel',
    year: 2010,
    votes: 8,
  },
  {
    id: 'pl_3',
    title: 'Tears of Steel',
    year: 2012,
    votes: 5,
  },
];

const INITIAL_POLL_OPTIONS: PollOptionEntry[] = [
  { id: 'opt_1', text: 'Classic animation', votes: 8 },
  { id: 'opt_2', text: 'Modern remaster', votes: 4 },
];

export function TheatreSidebar({
  isOpen,
  onClose,
  isMobileSheet = false,
  className = '',
}: TheatreSidebarProps) {
  const [activeTab, setActiveTab] = useState<TheatreTab>('chat');

  // Chat state
  const [messages, setMessages] = useState<ChatEntry[]>(INITIAL_MESSAGES);
  const [inputText, setInputText] = useState('');
  const chatScrollRef = useRef<HTMLDivElement>(null);

  // Queue state
  const [queue, setQueue] = useState<PlaylistItemEntry[]>(INITIAL_QUEUE);

  // Polls state
  const [pollOptions, setPollOptions] = useState<PollOptionEntry[]>(INITIAL_POLL_OPTIONS);
  const [userVotedId, setUserVotedId] = useState<string | null>('opt_1');

  // Auto-scroll chat on new message
  useEffect(() => {
    if (activeTab === 'chat' && chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages, activeTab]);

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;

    const newMessage: ChatEntry = {
      id: `c_${Date.now()}`,
      senderName: 'You',
      senderColor: '#F3E9DC',
      text: inputText.trim(),
    };

    setMessages((prev) => [...prev, newMessage]);
    setInputText('');
  };

  const handleUpvoteQueueItem = (id: string) => {
    setQueue((prev) => {
      const updated = prev.map((item) =>
        item.id === id ? { ...item, votes: item.votes + 1 } : item
      );
      const playingItem = updated.find((i) => i.isPlaying);
      const rest = updated.filter((i) => !i.isPlaying).sort((a, b) => b.votes - a.votes);
      return playingItem ? [playingItem, ...rest] : rest;
    });
  };

  const handleVotePoll = (optionId: string) => {
    if (userVotedId === optionId) return;

    setPollOptions((prev) => {
      const updated = prev.map((opt) => {
        if (opt.id === optionId) return { ...opt, votes: opt.votes + 1 };
        if (opt.id === userVotedId) return { ...opt, votes: Math.max(0, opt.votes - 1) };
        return opt;
      });
      return [...updated].sort((a, b) => b.votes - a.votes);
    });
    setUserVotedId(optionId);
  };

  const totalPollVotes = pollOptions.reduce((acc, curr) => acc + curr.votes, 0);

  if (!isOpen) return null;

  return (
    <aside
      className={`theatre-sidebar w-full lg:w-[360px] box-border flex flex-col bg-[#14100D] border-t lg:border-t-0 lg:border-l border-[#2A211B] p-5 font-ui select-none flex-shrink-0 ${className}`}
    >
      {/* 3 TABS: Chat, Queue, Polls */}
      <div style={{ display: 'flex', gap: '22px', borderBottom: '1px solid #2A211B', fontSize: '15px' }}>
        <button
          type="button"
          onClick={() => setActiveTab('chat')}
          style={{
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'chat' ? '2px solid #FF9F1C' : '2px solid transparent',
            color: activeTab === 'chat' ? '#F3E9DC' : '#A89B8C',
            fontWeight: activeTab === 'chat' ? 700 : 400,
            fontSize: '15px',
            padding: '0 0 12px',
            fontFamily: "'DM Sans', sans-serif",
            cursor: 'pointer',
          }}
        >
          Chat
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('queue')}
          style={{
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'queue' ? '2px solid #FF9F1C' : '2px solid transparent',
            color: activeTab === 'queue' ? '#F3E9DC' : '#A89B8C',
            fontWeight: activeTab === 'queue' ? 700 : 400,
            fontSize: '15px',
            padding: '0 0 12px',
            fontFamily: "'DM Sans', sans-serif",
            cursor: 'pointer',
          }}
        >
          Queue
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('polls')}
          style={{
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'polls' ? '2px solid #FF9F1C' : '2px solid transparent',
            color: activeTab === 'polls' ? '#F3E9DC' : '#A89B8C',
            fontWeight: activeTab === 'polls' ? 700 : 400,
            fontSize: '15px',
            padding: '0 0 12px',
            fontFamily: "'DM Sans', sans-serif",
            cursor: 'pointer',
          }}
        >
          Polls
        </button>
      </div>

      {/* TAB 1: CHAT */}
      {activeTab === 'chat' && (
        <div className="flex-1 flex flex-col justify-between overflow-hidden">
          {/* Messages list (without timestamps) */}
          <div
            ref={chatScrollRef}
            className="flex-1 flex flex-col gap-4 py-5 overflow-y-auto"
          >
            {messages.map((msg) => (
              <div key={msg.id}>
                <div className="flex justify-between text-[13px]">
                  <b style={{ color: msg.senderColor }}>{msg.senderName}</b>
                </div>
                <div className="text-base leading-[1.45] mt-1 text-[#F3E9DC]">
                  {msg.text}
                </div>
              </div>
            ))}
          </div>

          {/* Message Input & Send */}
          <form onSubmit={handleSendMessage} className="flex gap-2.5 pt-2">
            <input
              type="text"
              aria-label="Message"
              placeholder="Message"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              className="flex-1 box-border bg-[#1A1512] border border-[#3A2E26] rounded-xl px-4 py-3.25 text-[#F3E9DC] text-[15px] font-ui placeholder-[#A89B8C] focus:outline-none focus:border-[#FF9F1C] transition-colors"
            />
            <button
              type="submit"
              className="bg-[#FF9F1C] hover:brightness-105 active:scale-95 text-[#0E0B09] font-bold text-[15px] px-5 rounded-xl font-ui transition-all cursor-pointer flex-shrink-0"
            >
              Send
            </button>
          </form>
        </div>
      )}

      {/* TAB 2: QUEUE */}
      {activeTab === 'queue' && (
        <div className="flex-1 flex flex-col justify-between py-5 overflow-hidden">
          <div className="flex-1 space-y-3 overflow-y-auto">
            {queue.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between p-3.5 bg-[#1A1512] border border-[#2A211B] rounded-xl"
              >
                <div>
                  <div className="font-bold text-[15px] text-[#F3E9DC]">{item.title}</div>
                  {item.year && <div className="text-xs text-[#A89B8C]">{item.year}</div>}
                </div>
                {!item.isPlaying ? (
                  <button
                    type="button"
                    onClick={() => handleUpvoteQueueItem(item.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-[#261E19] hover:bg-[#3A2E26] text-[#F3E9DC] text-xs font-mono rounded-lg transition-colors cursor-pointer"
                  >
                    <span>▲</span>
                    <span>{item.votes}</span>
                  </button>
                ) : (
                  <span className="text-xs font-mono text-[#FF9F1C] bg-[#261E19] px-2.5 py-1 rounded-lg">
                    Playing
                  </span>
                )}
              </div>
            ))}
          </div>

          <button
            type="button"
            className="w-full mt-4 py-3 text-center border-[1.5px] border-[#5A4A3E] hover:border-[#FF9F1C] hover:text-[#FF9F1C] text-[#F3E9DC] rounded-full text-[15px] transition-colors"
          >
            Add movie
          </button>
        </div>
      )}

      {/* TAB 3: POLLS */}
      {activeTab === 'polls' && (
        <div className="flex-1 flex flex-col justify-between py-5 overflow-hidden">
          <div className="space-y-3">
            <div className="font-bold text-[15px] text-[#F3E9DC] mb-2">
              Next feature screening
            </div>
            {pollOptions.map((opt) => {
              const pct =
                totalPollVotes > 0 ? Math.round((opt.votes / totalPollVotes) * 100) : 0;
              const isSelected = userVotedId === opt.id;

              return (
                <div
                  key={opt.id}
                  onClick={() => handleVotePoll(opt.id)}
                  className={`relative p-3.5 rounded-xl border cursor-pointer transition-colors overflow-hidden ${
                    isSelected
                      ? 'border-[#FF9F1C] bg-[#261E19]'
                      : 'border-[#2A211B] bg-[#1A1512] hover:border-[#3A2E26]'
                  }`}
                >
                  <div
                    className="absolute inset-y-0 left-0 bg-[#FF9F1C]/20 pointer-events-none transition-all duration-300"
                    style={{ width: `${pct}%` }}
                  />
                  <div className="relative flex justify-between items-center text-[15px]">
                    <span className="font-medium text-[#F3E9DC]">{opt.text}</span>
                    <span className="font-mono text-xs text-[#A89B8C] ml-2">{pct}%</span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="text-xs text-[#A89B8C] font-mono text-center pt-4">
            {totalPollVotes} votes
          </div>
        </div>
      )}
    </aside>
  );
}
