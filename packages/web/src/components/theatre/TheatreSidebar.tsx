'use client';

/**
 * TheatreSidebar Component — Rave-Style Chat, Queue, People & Polls
 * 1. Pinned message input at the bottom of the viewport
 * 2. Real-time chat messages with user badges
 * 3. People tab showing seated members with real-time glowing voice rings
 * 4. Collaborative movie queue
 * 5. Audience polls & voting
 */

import React, { useState, useRef, useEffect } from 'react';
import { MOVIE_CATALOGUE, PlaylistItem, PollSummary } from '@watchparty/shared';

export type TheatreTab = 'chat' | 'queue' | 'people' | 'polls';

export interface ChatEntry {
  id: string;
  senderName: string;
  senderColor: string;
  text: string;
}

export interface TheatreMember {
  userId: string;
  userName: string;
  isHost?: boolean;
  isSpeaking?: boolean;
}

export interface TheatreSidebarProps {
  isOpen: boolean;
  onClose?: () => void;
  isMobileSheet?: boolean;
  currentRoomCode?: string;
  selfUserId?: string;
  messages: ChatEntry[];
  onSendMessage: (text: string) => void;
  queue: PlaylistItem[];
  onAddMovie: (videoId: string) => void;
  activePoll: PollSummary | null;
  onVotePoll: (pollId: string, optionIndex: number) => void;
  onCreatePoll?: (question: string, options: string[]) => void;
  members?: TheatreMember[];
  speakingMap?: Record<string, boolean>;
  onToggleMic?: () => void;
  className?: string;
}

export function TheatreSidebar({
  isOpen,
  onClose,
  isMobileSheet = false,
  currentRoomCode = '',
  selfUserId = '',
  messages = [],
  onSendMessage,
  queue = [],
  onAddMovie,
  activePoll,
  onVotePoll,
  onCreatePoll,
  members = [],
  speakingMap = {},
  onToggleMic,
  className = '',
}: TheatreSidebarProps) {
  const [activeTab, setActiveTab] = useState<TheatreTab>('chat');

  // Chat state
  const [inputText, setInputText] = useState('');
  const chatScrollRef = useRef<HTMLDivElement>(null);

  // Queue state: movie picker modal
  const [showMoviePicker, setShowMoviePicker] = useState(false);

  // Polls state
  const [votedOptionId, setVotedOptionId] = useState<string | null>(null);
  const [showCreatePoll, setShowCreatePoll] = useState(false);
  const [newPollQuestion, setNewPollQuestion] = useState('');
  const [newOption1, setNewOption1] = useState('');
  const [newOption2, setNewOption2] = useState('');

  // Auto-scroll chat on new message
  useEffect(() => {
    if (activeTab === 'chat' && chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages, activeTab]);

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    onSendMessage(inputText.trim());
    setInputText('');
  };

  const handleSelectMovieToAdd = (videoId: string) => {
    onAddMovie(videoId);
    setShowMoviePicker(false);
  };

  const handleVote = (pollId: string, optionId: string, optionIndex: number) => {
    setVotedOptionId(optionId);
    onVotePoll(pollId, optionIndex);
  };

  const handleCreatePollSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPollQuestion.trim() || !newOption1.trim() || !newOption2.trim()) return;
    if (onCreatePoll) {
      onCreatePoll(newPollQuestion.trim(), [newOption1.trim(), newOption2.trim()]);
    }
    setNewPollQuestion('');
    setNewOption1('');
    setNewOption2('');
    setShowCreatePoll(false);
  };

  const totalPollVotes = activePoll
    ? activePoll.options.reduce((acc, curr) => acc + curr.votes, 0)
    : 0;

  if (!isOpen) return null;

  return (
    <aside
      className={`theatre-sidebar w-full lg:w-[360px] box-border flex flex-col h-full bg-[#14100D] border-t lg:border-t-0 lg:border-l border-[#2A211B] p-4 sm:p-5 font-ui select-none flex-shrink-0 min-h-0 ${className}`}
    >
      {/* 4 TABS: Chat, Queue, People, Polls */}
      <div className="flex items-center gap-4 border-b border-[#2A211B] text-sm flex-shrink-0 pb-1 overflow-x-auto">
        <button
          type="button"
          onClick={() => setActiveTab('chat')}
          className={`pb-2.5 font-medium transition-colors cursor-pointer border-b-2 whitespace-nowrap bg-transparent ${
            activeTab === 'chat'
              ? 'border-[#FF9F1C] text-[#F3E9DC] font-bold'
              : 'border-transparent text-[#A89B8C] hover:text-[#F3E9DC]'
          }`}
        >
          Chat
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('queue')}
          className={`pb-2.5 font-medium transition-colors cursor-pointer border-b-2 whitespace-nowrap bg-transparent ${
            activeTab === 'queue'
              ? 'border-[#FF9F1C] text-[#F3E9DC] font-bold'
              : 'border-transparent text-[#A89B8C] hover:text-[#F3E9DC]'
          }`}
        >
          Queue ({queue.length})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('people')}
          className={`pb-2.5 font-medium transition-colors cursor-pointer border-b-2 whitespace-nowrap bg-transparent ${
            activeTab === 'people'
              ? 'border-[#FF9F1C] text-[#F3E9DC] font-bold'
              : 'border-transparent text-[#A89B8C] hover:text-[#F3E9DC]'
          }`}
        >
          People ({members.length})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('polls')}
          className={`pb-2.5 font-medium transition-colors cursor-pointer border-b-2 whitespace-nowrap bg-transparent ${
            activeTab === 'polls'
              ? 'border-[#FF9F1C] text-[#F3E9DC] font-bold'
              : 'border-transparent text-[#A89B8C] hover:text-[#F3E9DC]'
          }`}
        >
          Polls
        </button>
      </div>

      {/* ── TAB 1: CHAT ──────────────────────────────────────────────────────── */}
      {activeTab === 'chat' && (
        <div className="flex-1 flex flex-col justify-between pt-4 min-h-0 overflow-hidden">
          <div ref={chatScrollRef} className="flex-1 space-y-3 overflow-y-auto min-h-0 pr-1">
            {messages.length === 0 ? (
              <div className="py-8 text-center text-xs font-mono text-[#A89B8C]">
                Whisper something to the suite…
              </div>
            ) : (
              messages.map((msg) => (
                <div key={msg.id} className="text-sm leading-relaxed break-words">
                  <span style={{ color: msg.senderColor }} className="font-bold mr-2 font-display">
                    {msg.senderName}:
                  </span>
                  <span className="text-[#F3E9DC] font-ui">{msg.text}</span>
                </div>
              ))
            )}
          </div>

          <form
            onSubmit={handleSendMessage}
            className="flex gap-2 pt-3 border-t border-[#2A211B] flex-shrink-0 mt-auto"
          >
            <input
              type="text"
              aria-label="Message"
              placeholder="Send a whisper…"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              className="flex-1 box-border bg-[#1A1512] border border-[#3A2E26] rounded-xl px-4 py-2.5 text-[#F3E9DC] text-sm placeholder-[#A89B8C] focus:outline-none focus:border-[#FF9F1C]"
            />
            <button
              type="submit"
              className="bg-[#FF9F1C] hover:brightness-105 active:scale-95 text-[#0E0B09] font-bold text-sm px-4 rounded-xl border-none cursor-pointer flex-shrink-0"
            >
              Send
            </button>
          </form>
        </div>
      )}

      {/* ── TAB 2: QUEUE ─────────────────────────────────────────────────────── */}
      {activeTab === 'queue' && (
        <div className="flex-1 flex flex-col justify-between pt-4 min-h-0 overflow-hidden">
          <div className="flex-1 space-y-3 overflow-y-auto min-h-0 pr-1">
            {queue.length === 0 ? (
              <div className="py-8 text-center text-xs font-mono text-[#A89B8C]">
                The playlist queue is empty. Add a film to watch next!
              </div>
            ) : (
              queue.map((item, idx) => (
                <div
                  key={item.id || idx}
                  className="flex items-center justify-between p-3 bg-[#1A1512] border border-[#2A211B] rounded-xl"
                >
                  <div className="min-w-0 pr-2">
                    <div className="font-bold text-sm text-[#F3E9DC] truncate">{item.title}</div>
                    <div className="text-[11px] font-mono text-[#A89B8C] mt-0.5">
                      {item.addedByUserName ? `Queued by ${item.addedByUserName}` : 'Catalogue'}
                    </div>
                  </div>
                  <span className="font-mono text-xs text-[#FF9F1C]">#{idx + 1}</span>
                </div>
              ))
            )}
          </div>

          <div className="pt-3 border-t border-[#2A211B] flex-shrink-0">
            <button
              type="button"
              onClick={() => setShowMoviePicker(true)}
              className="w-full py-2.5 bg-[#261E19] hover:bg-[#322720] border border-[#3A2E26] hover:border-[#FF9F1C] text-[#F3E9DC] font-bold text-xs rounded-xl cursor-pointer transition-colors"
            >
              ＋ Add Film to Queue
            </button>
          </div>
        </div>
      )}

      {/* ── TAB 3: PEOPLE (VOICE & MIC ROSTER) ─────────────────────────────────── */}
      {activeTab === 'people' && (
        <div className="flex-1 flex flex-col justify-between pt-4 min-h-0 overflow-hidden">
          <div className="flex-1 space-y-2.5 overflow-y-auto min-h-0 pr-1">
            {members.length === 0 ? (
              <div className="py-8 text-center text-xs font-mono text-[#A89B8C]">
                No patrons seated yet.
              </div>
            ) : (
              members.map((member) => {
                const isSpeaking = Boolean(speakingMap[member.userId] || member.isSpeaking);
                const isSelf = member.userId === selfUserId;
                const initial = (member.userName || 'P')[0].toUpperCase();

                return (
                  <div
                    key={member.userId}
                    className="flex items-center justify-between p-3 bg-[#1A1512] border border-[#2A211B] rounded-xl"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        className={`w-9 h-9 rounded-full bg-[#FF9F1C] text-[#0E0B09] font-bold text-sm flex items-center justify-center flex-shrink-0 transition-all ${
                          isSpeaking ? 'ring-2 ring-[#2EC4B6] shadow-[0_0_10px_#2EC4B6]' : ''
                        }`}
                      >
                        {initial}
                      </span>
                      <div className="min-w-0">
                        <div className="font-bold text-sm text-[#F3E9DC] truncate flex items-center gap-1.5">
                          <span>{member.userName}</span>
                          {member.isHost && (
                            <span className="text-[10px] font-mono bg-[#FF9F1C]/20 text-[#FF9F1C] px-1.5 py-0.2 rounded font-bold">
                              HOST
                            </span>
                          )}
                          {isSelf && (
                            <span className="text-[10px] font-mono text-[#A89B8C]">
                              (You)
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] font-mono text-[#A89B8C] mt-0.5 flex items-center gap-1">
                          {isSpeaking ? (
                            <span className="text-[#2EC4B6] font-bold flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-[#2EC4B6] animate-ping" />
                              Speaking (Auto-Ducked)
                            </span>
                          ) : (
                            <span>Listening</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {isSelf && onToggleMic && (
                      <button
                        type="button"
                        onClick={onToggleMic}
                        className={`px-3 py-1.5 rounded-lg text-xs font-mono border cursor-pointer transition-colors ${
                          isSpeaking
                            ? 'bg-[#2EC4B6] text-[#0E0B09] border-[#2EC4B6] font-bold'
                            : 'bg-[#261E19] text-[#A89B8C] border-[#3A2E26]'
                        }`}
                      >
                        {isSpeaking ? 'Mute Mic' : 'Unmute Mic'}
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>

          <div className="pt-3 border-t border-[#2A211B] text-center text-xs font-mono text-[#A89B8C]">
            Audio ducking lowers movie volume by 25% when anyone speaks.
          </div>
        </div>
      )}

      {/* ── TAB 4: POLLS ─────────────────────────────────────────────────────── */}
      {activeTab === 'polls' && (
        <div className="flex-1 flex flex-col justify-between pt-4 min-h-0 overflow-hidden">
          <div className="flex-1 space-y-4 overflow-y-auto min-h-0 pr-1">
            {activePoll ? (
              <div className="p-4 bg-[#1A1512] border border-[#3A2E26] rounded-xl space-y-3">
                <div className="font-display font-bold text-base text-[#F3E9DC]">{activePoll.question}</div>
                <div className="space-y-2">
                  {activePoll.options.map((opt, idx) => {
                    const pct = totalPollVotes > 0 ? Math.round((opt.votes / totalPollVotes) * 100) : 0;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => handleVote(activePoll.id, opt.id, idx)}
                        className={`w-full text-left p-3 rounded-lg border text-xs font-mono relative overflow-hidden cursor-pointer transition-all ${
                          votedOptionId === opt.id
                            ? 'bg-[#261E19] border-[#FF9F1C] text-[#FF9F1C]'
                            : 'bg-[#14100D] border-[#3A2E26] text-[#F3E9DC] hover:border-[#5A4A3E]'
                        }`}
                      >
                        <div
                          style={{ width: `${pct}%` }}
                          className="absolute inset-y-0 left-0 bg-[#FF9F1C]/15 pointer-events-none"
                        />
                        <div className="relative flex justify-between items-center z-10">
                          <span>{opt.text}</span>
                          <span className="font-bold">{pct}% ({opt.votes})</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : !showCreatePoll ? (
              <div className="py-8 text-center text-xs font-mono text-[#A89B8C]">
                No active poll right now.
              </div>
            ) : (
              <form onSubmit={handleCreatePollSubmit} className="space-y-3 p-4 bg-[#1A1512] border border-[#2A211B] rounded-xl">
                <div className="text-xs font-mono text-[#FF9F1C] uppercase">Create Audience Poll</div>
                <input
                  type="text"
                  placeholder="What should we screen next?"
                  value={newPollQuestion}
                  onChange={(e) => setNewPollQuestion(e.target.value)}
                  className="w-full bg-[#261E19] border border-[#3A2E26] rounded-lg px-3 py-2 text-xs text-[#F3E9DC] focus:outline-none focus:border-[#FF9F1C]"
                  required
                />
                <input
                  type="text"
                  placeholder="Option 1"
                  value={newOption1}
                  onChange={(e) => setNewOption1(e.target.value)}
                  className="w-full bg-[#261E19] border border-[#3A2E26] rounded-lg px-3 py-2 text-xs text-[#F3E9DC] focus:outline-none focus:border-[#FF9F1C]"
                  required
                />
                <input
                  type="text"
                  placeholder="Option 2"
                  value={newOption2}
                  onChange={(e) => setNewOption2(e.target.value)}
                  className="w-full bg-[#261E19] border border-[#3A2E26] rounded-lg px-3 py-2 text-xs text-[#F3E9DC] focus:outline-none focus:border-[#FF9F1C]"
                  required
                />
                <div className="flex gap-2 pt-1">
                  <button
                    type="submit"
                    className="flex-1 bg-[#FF9F1C] text-[#0E0B09] font-bold py-2 rounded-lg text-xs cursor-pointer border-none"
                  >
                    Launch Poll
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowCreatePoll(false)}
                    className="px-3 py-2 bg-[#261E19] text-[#A89B8C] rounded-lg text-xs cursor-pointer border-none"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>

          {!showCreatePoll && (
            <div className="pt-3 border-t border-[#2A211B] flex-shrink-0">
              <button
                type="button"
                onClick={() => setShowCreatePoll(true)}
                className="w-full py-2.5 bg-[#261E19] hover:bg-[#322720] border border-[#3A2E26] hover:border-[#FF9F1C] text-[#F3E9DC] font-bold text-xs rounded-xl cursor-pointer transition-colors"
              >
                ＋ Create New Poll
              </button>
            </div>
          )}
        </div>
      )}

      {/* Movie Picker Modal for Queue */}
      {showMoviePicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-[#1A1512] border border-[#3A2E26] rounded-2xl p-5 max-w-md w-full max-h-[80vh] flex flex-col">
            <div className="flex justify-between items-center mb-3">
              <span className="font-display font-bold text-base text-[#F3E9DC]">Choose Film to Queue</span>
              <button
                type="button"
                onClick={() => setShowMoviePicker(false)}
                className="text-[#A89B8C] hover:text-[#F3E9DC] bg-transparent border-none cursor-pointer"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {MOVIE_CATALOGUE.map((m) => (
                <div
                  key={m.id}
                  onClick={() => handleSelectMovieToAdd(m.id)}
                  className="p-2.5 bg-[#261E19] hover:bg-[#322720] border border-[#3A2E26] hover:border-[#FF9F1C] rounded-xl flex items-center gap-3 cursor-pointer transition-colors"
                >
                  <img src={m.posterUrl} alt={m.title} className="w-10 h-14 object-cover rounded bg-black flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-sm text-[#F3E9DC] truncate">{m.title}</div>
                    <div className="text-[11px] font-mono text-[#A89B8C]">{m.year} &bull; {m.runtime}m</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
