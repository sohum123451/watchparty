'use client';

/**
 * TheatreSidebar Component
 * Cinema Suite interactive console:
 * 1. Desktop slide-in sidebar that collapses completely in Cinema Mode
 * 2. Mobile responsive bottom sheet with drag handle
 * 3. Chat: Auditorium messages ease in with anime.js / CSS transitions
 * 4. Playlist: Reorders with animated layout shifts when upvoted
 * 5. Polls: Dynamic bar width animations and live reordering based on vote count
 * 6. Patrons: Voice speakers receive glowing cathode teal rings and audio waveforms
 */

import React, { useState, useRef, useEffect } from 'react';

export type TheatreTab = 'chat' | 'playlist' | 'polls' | 'members';

export interface ChatEntry {
  id: string;
  senderName: string;
  avatar: string;
  timecode: string;
  text: string;
  isHost?: boolean;
  isSpeaking?: boolean;
}

export interface PlaylistItemEntry {
  id: string;
  title: string;
  year: number;
  format: string;
  runtime: string;
  votes: number;
  isPlaying?: boolean;
}

export interface PollOptionEntry {
  id: string;
  text: string;
  votes: number;
}

export interface MemberEntry {
  id: string;
  name: string;
  seatLabel: string;
  avatar: string;
  isHost?: boolean;
  isSpeaking?: boolean;
  isMuted?: boolean;
}

export interface TheatreSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  isMobileSheet?: boolean;
  speakingMembers?: string[]; // IDs of speaking members
  onToggleUserSpeaking?: () => void;
  isUserSpeaking?: boolean;
  currentRoomCode?: string;
  className?: string;
}

const INITIAL_MESSAGES: ChatEntry[] = [
  {
    id: 'c1',
    senderName: 'Elena Rostova',
    avatar: 'E',
    timecode: '01:22:04',
    text: 'Listen to the Vangelis CS-80 synth swell right here...',
    isHost: true,
  },
  {
    id: 'c2',
    senderName: 'Marcus Vance',
    avatar: 'M',
    timecode: '01:22:45',
    text: 'The 70mm grain on the Tyrell pyramid looks razor sharp tonight.',
  },
  {
    id: 'c3',
    senderName: 'Sophia Chen',
    avatar: 'S',
    timecode: '01:23:18',
    text: 'That practical matte painting is timeless cinema.',
  },
];

const INITIAL_PLAYLIST: PlaylistItemEntry[] = [
  {
    id: 'pl_1',
    title: 'Blade Runner (Final Cut)',
    year: 1982,
    format: '70mm Dolby Atmos',
    runtime: '117m',
    votes: 99,
    isPlaying: true,
  },
  {
    id: 'pl_2',
    title: '2001: A Space Odyssey (Roadshow Cut)',
    year: 1968,
    format: '70mm Panavision',
    runtime: '149m',
    votes: 7,
  },
  {
    id: 'pl_3',
    title: 'Stalker (Tarkovsky 4K Master)',
    year: 1979,
    format: '4K Criterion',
    runtime: '162m',
    votes: 5,
  },
  {
    id: 'pl_4',
    title: 'Solaris (1972 Nitrate Print)',
    year: 1972,
    format: '35mm Vintage',
    runtime: '167m',
    votes: 3,
  },
];

const INITIAL_POLL_OPTIONS: PollOptionEntry[] = [
  { id: 'opt_1', text: 'Yes, Gaff’s origami unicorn proves Deckard is a Replicant', votes: 6 },
  { id: 'opt_2', text: 'No, he is human; that makes Roy Batty’s mercy impactful', votes: 5 },
  { id: 'opt_3', text: 'Deliberate ambiguity by Ridley Scott and Hampton Fancher', votes: 4 },
];

const INITIAL_MEMBERS: MemberEntry[] = [
  { id: 'm1', name: 'Elena Rostova', seatLabel: 'Orchestra 1A', avatar: 'E', isHost: true },
  { id: 'm2', name: 'Marcus Vance', seatLabel: 'Orchestra 1B', avatar: 'M', isSpeaking: true },
  { id: 'm3', name: 'Sophia Chen', seatLabel: 'Orchestra 2A', avatar: 'S' },
  { id: 'm4', name: 'Dmitri K.', seatLabel: 'Balcony 1', avatar: 'D' },
  { id: 'm_me', name: 'You (Patron)', seatLabel: 'Orchestra 2B', avatar: 'Y' },
];

export function TheatreSidebar({
  isOpen,
  onClose,
  isMobileSheet = false,
  isUserSpeaking = false,
  onToggleUserSpeaking,
  currentRoomCode = 'CRITERION-70MM',
  className = '',
}: TheatreSidebarProps) {
  const [activeTab, setActiveTab] = useState<TheatreTab>('chat');

  // Chat state
  const [messages, setMessages] = useState<ChatEntry[]>(INITIAL_MESSAGES);
  const [inputText, setInputText] = useState('');
  const chatScrollRef = useRef<HTMLDivElement>(null);

  // Playlist state
  const [playlist, setPlaylist] = useState<PlaylistItemEntry[]>(INITIAL_PLAYLIST);

  // Polls state
  const [pollOptions, setPollOptions] = useState<PollOptionEntry[]>(INITIAL_POLL_OPTIONS);
  const [userVotedId, setUserVotedId] = useState<string | null>('opt_1');

  // Members state
  const [members, setMembers] = useState<MemberEntry[]>(INITIAL_MEMBERS);

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
      avatar: 'Y',
      timecode: '01:24:18',
      text: inputText.trim(),
    };

    setMessages((prev) => [...prev, newMessage]);
    setInputText('');
  };

  const handleUpvotePlaylistItem = (id: string) => {
    setPlaylist((prev) => {
      const updated = prev.map((item) =>
        item.id === id ? { ...item, votes: item.votes + 1 } : item
      );
      // Keep playing item at top, sort remainder by votes descending with animated layout shift
      const playingItem = updated.find((i) => i.isPlaying);
      const queue = updated.filter((i) => !i.isPlaying).sort((a, b) => b.votes - a.votes);
      return playingItem ? [playingItem, ...queue] : queue;
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
      // Reorder with animated layout shift based on highest votes
      return [...updated].sort((a, b) => b.votes - a.votes);
    });
    setUserVotedId(optionId);
  };

  const totalPollVotes = pollOptions.reduce((acc, curr) => acc + curr.votes, 0);

  if (!isOpen) return null;

  return (
    <aside
      className={`theatre-sidebar bg-surface/95 border-border-brass flex flex-col justify-between backdrop-blur-md transition-all duration-300 shadow-velvet-raised ${
        isMobileSheet
          ? 'fixed bottom-0 left-0 right-0 max-h-[60vh] border-t rounded-t-lg z-40'
          : 'relative w-80 md:w-96 border-l h-full z-30'
      } ${className}`}
    >
      {/* 1. SIDEBAR HEADER: TABS & CINEMA COLLAPSE BUTTON */}
      <div>
        {/* Mobile Drag Indicator Bar */}
        {isMobileSheet && (
          <div className="flex justify-center pt-2 pb-1">
            <div className="w-12 h-1 rounded-full bg-border-brass/70" />
          </div>
        )}

        <div className="flex justify-between items-center p-3 border-b border-border-brass bg-surface-2/80">
          <div className="flex items-center gap-1.5 font-mono text-[11px]">
            <span className="w-1.5 h-1.5 rounded-full bg-live animate-cathode-pulse" />
            <span className="text-accent font-bold uppercase">SUITE #{currentRoomCode}</span>
          </div>

          {/* Close / Collapse into Cinema Mode Button */}
          <button
            onClick={onClose}
            className="p-1 px-2 hover:bg-surface-3 active:scale-95 text-muted hover:text-text rounded-sm font-mono text-xs flex items-center gap-1 cursor-pointer transition-all"
            title="Collapse Sidebar (Cinema Mode)"
          >
            <span>Cinema View</span>
            <span>✕</span>
          </button>
        </div>

        {/* 4 SIDEBAR TABS */}
        <div className="grid grid-cols-4 gap-1 p-1.5 bg-surface-2 border-b border-border-brass font-mono text-xs">
          <button
            onClick={() => setActiveTab('chat')}
            className={`py-1.5 text-center rounded-[2px] transition-all cursor-pointer flex items-center justify-center gap-1 ${
              activeTab === 'chat'
                ? 'bg-accent text-bg font-bold shadow-sm'
                : 'text-muted hover:text-text'
            }`}
          >
            <span>Whisper</span>
          </button>
          <button
            onClick={() => setActiveTab('playlist')}
            className={`py-1.5 text-center rounded-[2px] transition-all cursor-pointer flex items-center justify-center gap-1 ${
              activeTab === 'playlist'
                ? 'bg-accent text-bg font-bold shadow-sm'
                : 'text-muted hover:text-text'
            }`}
          >
            <span>Reels</span>
          </button>
          <button
            onClick={() => setActiveTab('polls')}
            className={`py-1.5 text-center rounded-[2px] transition-all cursor-pointer flex items-center justify-center gap-1 relative ${
              activeTab === 'polls'
                ? 'bg-accent text-bg font-bold shadow-sm'
                : 'text-muted hover:text-text'
            }`}
          >
            <span>Polls</span>
            <span className="w-1.5 h-1.5 rounded-full bg-accent-2" />
          </button>
          <button
            onClick={() => setActiveTab('members')}
            className={`py-1.5 text-center rounded-[2px] transition-all cursor-pointer flex items-center justify-center gap-1 ${
              activeTab === 'members'
                ? 'bg-accent text-bg font-bold shadow-sm'
                : 'text-muted hover:text-text'
            }`}
          >
            <span>Seats</span>
            <span className="text-[10px]">({members.length})</span>
          </button>
        </div>
      </div>

      {/* 2. TAB BODY CONTENT */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* ================= TAB 1: CHAT WITH EASE-IN MESSAGES ================= */}
        {activeTab === 'chat' && (
          <div className="flex flex-col h-full justify-between">
            <div
              ref={chatScrollRef}
              className="flex-1 overflow-y-auto space-y-3 pr-1 scrollbar-thin"
            >
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className="chat-message-item group flex gap-2.5 items-start p-2 rounded-sm bg-surface-2/40 hover:bg-surface-2 border border-transparent hover:border-border-brass transition-all duration-300 animate-fadeIn"
                >
                  <div className="w-6 h-6 rounded-full bg-surface-3 border border-border-brass flex items-center justify-center font-display text-[10px] font-bold text-text flex-shrink-0 mt-0.5">
                    {msg.avatar}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-display font-semibold text-xs text-text truncate">
                        {msg.senderName}
                      </span>
                      {msg.isHost && (
                        <span className="px-1 py-0.2 bg-accent/20 border border-border-brass rounded-sm font-mono text-[9px] text-accent uppercase">
                          Host
                        </span>
                      )}
                      <span className="font-mono text-[10px] text-muted ml-auto tabular-nums">
                        {msg.timecode}
                      </span>
                    </div>
                    <p className="font-sans text-xs text-muted-bright leading-relaxed break-words">
                      {msg.text}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {/* Whisper Input */}
            <form onSubmit={handleSendMessage} className="mt-3 pt-3 border-t border-border-brass flex gap-2">
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Whisper during quiet scene..."
                className="flex-1 px-3 py-2 bg-bg border border-border-brass rounded-sm font-sans text-xs text-text placeholder-muted focus:outline-none focus:border-accent shadow-inner"
              />
              <button
                type="submit"
                className="px-3 py-2 bg-accent hover:bg-accent/90 active:scale-95 text-[#0E0B09] font-mono text-xs font-bold rounded-sm shadow-sm transition-all cursor-pointer"
              >
                Send
              </button>
            </form>
          </div>
        )}

        {/* ================= TAB 2: PLAYLIST REELS (ANIMATED REORDER) ================= */}
        {activeTab === 'playlist' && (
          <div className="space-y-3">
            <div className="flex justify-between items-center text-xs font-mono text-muted pb-1 border-b border-border-brass">
              <span>UPCOMING REELS</span>
              <span>VOTE TO ADVANCE</span>
            </div>

            <div className="space-y-2">
              {playlist.map((item, index) => (
                <div
                  key={item.id}
                  className={`playlist-item-row p-3 rounded-sm border transition-all duration-300 transform flex items-center justify-between gap-3 ${
                    item.isPlaying
                      ? 'bg-surface-3 border-accent text-text shadow-projector'
                      : 'bg-surface-2 border-border-subtle hover:border-border-brass'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="font-mono text-xs text-muted w-4 flex-shrink-0">
                      {item.isPlaying ? '▶' : `${index + 1}`}
                    </span>
                    <div className="truncate">
                      <div className="font-display font-bold text-xs truncate text-text">
                        {item.title}
                      </div>
                      <div className="text-[10px] font-mono text-muted flex items-center gap-1.5 mt-0.5">
                        <span>{item.year}</span>
                        <span>&bull;</span>
                        <span className="text-accent">{item.format}</span>
                        <span>&bull;</span>
                        <span>{item.runtime}</span>
                      </div>
                    </div>
                  </div>

                  {!item.isPlaying && (
                    <button
                      onClick={() => handleUpvotePlaylistItem(item.id)}
                      className="px-2.5 py-1 bg-surface hover:bg-surface-3 active:scale-95 border border-border-brass rounded-sm font-mono text-xs text-text hover:text-accent transition-all flex items-center gap-1 cursor-pointer flex-shrink-0 shadow-sm"
                      title="Bump reel in queue"
                    >
                      <span>▲</span>
                      <span className="tabular-nums font-bold">{item.votes}</span>
                    </button>
                  )}
                  {item.isPlaying && (
                    <span className="px-2 py-0.5 bg-accent text-[#0E0B09] font-mono font-bold text-[10px] rounded-sm uppercase tracking-wider flex-shrink-0">
                      Projecting
                    </span>
                  )}
                </div>
              ))}
            </div>

            <div className="pt-2 text-center">
              <button
                type="button"
                className="w-full py-2 bg-surface-2 hover:bg-surface-3 active:scale-95 text-muted hover:text-accent border border-dashed border-border-brass rounded-sm font-mono text-xs transition-all cursor-pointer"
              >
                + Queue Reel from Film Vault
              </button>
            </div>
          </div>
        )}

        {/* ================= TAB 3: AUDIENCE POLLS (ANIMATED BAR WIDTHS) ================= */}
        {activeTab === 'polls' && (
          <div className="space-y-4">
            <div className="p-3 bg-surface-2 border border-border-brass rounded-sm">
              <div className="flex items-center gap-2 text-[10px] font-mono text-accent uppercase tracking-wider mb-1">
                <span className="w-1.5 h-1.5 rounded-full bg-live shadow-cathode animate-pulse" />
                <span>Auditorium Straw Poll</span>
                <span className="text-muted ml-auto">{totalPollVotes} Ballots Cast</span>
              </div>
              <h3 className="font-display font-bold text-sm text-text leading-snug">
                Is Rick Deckard an Android Replicant?
              </h3>
            </div>

            {/* Poll Options (reorder with animated layout shifts) */}
            <div className="space-y-2.5">
              {pollOptions.map((opt) => {
                const percentage =
                  totalPollVotes > 0 ? Math.round((opt.votes / totalPollVotes) * 100) : 0;
                const isSelected = userVotedId === opt.id;

                return (
                  <div
                    key={opt.id}
                    onClick={() => handleVotePoll(opt.id)}
                    className={`poll-option-row relative overflow-hidden p-3 rounded-sm border cursor-pointer transition-all duration-300 transform active:scale-98 ${
                      isSelected
                        ? 'border-accent bg-surface-3/80 shadow-sm'
                        : 'border-border-subtle bg-surface-2 hover:border-border-brass'
                    }`}
                  >
                    {/* Animated Percentage Fill Bar */}
                    <div
                      className={`absolute top-0 bottom-0 left-0 transition-all duration-500 ease-out pointer-events-none ${
                        isSelected ? 'bg-accent/20' : 'bg-surface-3/60'
                      }`}
                      style={{ width: `${percentage}%` }}
                    />

                    {/* Content */}
                    <div className="relative z-10 flex justify-between items-center gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        {isSelected && <span className="text-accent text-xs">✔</span>}
                        <span className="font-sans text-xs text-text leading-tight">
                          {opt.text}
                        </span>
                      </div>
                      <div className="font-mono text-xs font-bold text-accent tabular-nums flex-shrink-0">
                        {percentage}%
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ================= TAB 4: PATRONS & VOICE SPEAKERS ================= */}
        {activeTab === 'members' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center text-xs font-mono text-muted pb-1 border-b border-border-brass">
              <span>AUDITORIUM ROSTER</span>
              <span>SPATIAL AUDIO</span>
            </div>

            <div className="space-y-2">
              {members.map((m) => {
                const isSpeaking = m.id === 'm_me' ? isUserSpeaking : m.isSpeaking;

                return (
                  <div
                    key={m.id}
                    className="p-2.5 bg-surface-2 border border-border-subtle rounded-sm flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-3">
                      {/* Avatar with GLOWING VOICE RING when speaking */}
                      <div className="relative">
                        <div
                          className={`w-8 h-8 rounded-full bg-surface-3 flex items-center justify-center font-display text-xs font-bold text-text transition-all duration-300 ${
                            isSpeaking
                              ? 'ring-2 ring-live shadow-[0_0_14px_rgba(46,196,182,0.8)] scale-105'
                              : 'border border-border-brass'
                          }`}
                        >
                          {m.avatar}
                        </div>

                        {/* Speaking Waveform Dot */}
                        {isSpeaking && (
                          <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-live border-2 border-surface shadow-cathode animate-pulse" />
                        )}
                      </div>

                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-display font-semibold text-xs text-text">
                            {m.name}
                          </span>
                          {m.isHost && (
                            <span className="text-[9px] font-mono text-accent uppercase font-bold">
                              Host
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] font-mono text-muted">{m.seatLabel}</div>
                      </div>
                    </div>

                    {/* Speaking Status / Mic Toggle */}
                    <div>
                      {m.id === 'm_me' ? (
                        <button
                          onClick={onToggleUserSpeaking}
                          className={`px-2 py-1 rounded-sm font-mono text-[10px] transition-all cursor-pointer flex items-center gap-1 active:scale-95 ${
                            isUserSpeaking
                              ? 'bg-live text-[#0E0B09] font-bold shadow-cathode'
                              : 'bg-surface-3 text-muted hover:text-text border border-border-brass'
                          }`}
                        >
                          <span>{isUserSpeaking ? '🎙 Speaking' : '🔇 Muted'}</span>
                        </button>
                      ) : isSpeaking ? (
                        <span className="text-[10px] font-mono text-live flex items-center gap-1">
                          <span className="animate-pulse">●</span>
                          <span>Voice</span>
                        </span>
                      ) : (
                        <span className="text-[10px] font-mono text-muted">Listening</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* 3. SIDEBAR FOOTER: USER MIC STATUS & SEAT IDENTITY */}
      <div className="p-3 bg-surface-2 border-t border-border-brass flex items-center justify-between text-xs font-mono text-muted">
        <div className="flex items-center gap-2">
          <div
            className={`w-2 h-2 rounded-full ${
              isUserSpeaking ? 'bg-live shadow-cathode animate-pulse' : 'bg-muted/50'
            }`}
          />
          <span className="text-text font-medium">Orchestra Row 2</span>
        </div>
        <button
          onClick={onToggleUserSpeaking}
          className="text-accent hover:underline cursor-pointer text-[11px]"
        >
          {isUserSpeaking ? 'Click to Mute' : 'Press to Whisper'}
        </button>
      </div>
    </aside>
  );
}
