'use client';

/**
 * TheatreSidebar Component
 * Real-time Sidebar with Chat, Queue, and Polls tabs:
 * 1. Pinned message input at the bottom of the viewport
 * 2. Real chat messages without mockup placeholders
 * 3. Real movie queue with catalogue movie picker
 * 4. Real poll voting and poll creation
 */

import React, { useState, useRef, useEffect } from 'react';
import { MOVIE_CATALOGUE, PlaylistItem, PollSummary } from '@watchparty/shared';

export type TheatreTab = 'chat' | 'queue' | 'polls';

export interface ChatEntry {
  id: string;
  senderName: string;
  senderColor: string;
  text: string;
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
  className = '',
}: TheatreSidebarProps) {
  const [activeTab, setActiveTab] = useState<TheatreTab>('chat');

  // Chat state
  const [inputText, setInputText] = useState('');
  const chatScrollRef = useRef<HTMLDivElement>(null);

  // Queue state: movie picker modal
  const [showMoviePicker, setShowMoviePicker] = useState(false);

  // Polls state: local selected option ID & poll creation form
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
      className={`theatre-sidebar w-full lg:w-[360px] box-border flex flex-col h-full bg-[#14100D] border-t lg:border-t-0 lg:border-l border-[#2A211B] p-5 font-ui select-none flex-shrink-0 min-h-0 ${className}`}
    >
      {/* 3 TABS: Chat, Queue, Polls */}
      <div className="flex gap-5 border-b border-[#2A211B] text-[15px] flex-shrink-0">
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
          Queue {queue.length > 0 ? `(${queue.length})` : ''}
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
        <div className="flex-1 flex flex-col justify-between min-h-0 overflow-hidden mt-3">
          {/* Messages list (without timestamps) */}
          <div
            ref={chatScrollRef}
            className="flex-1 flex flex-col gap-3 py-2 overflow-y-auto min-h-0 pr-1"
          >
            {messages.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-center text-sm text-[#A89B8C] py-8">
                No messages yet. Say hello to the room!
              </div>
            ) : (
              messages.map((msg) => (
                <div key={msg.id} className="flex flex-col">
                  <div className="flex justify-between text-[13px]">
                    <b style={{ color: msg.senderColor }}>{msg.senderName}</b>
                  </div>
                  <div className="text-base leading-[1.45] mt-0.5 text-[#F3E9DC] break-words">
                    {msg.text}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Message Input & Send - Pinned to bottom */}
          <form
            onSubmit={handleSendMessage}
            className="flex gap-2.5 pt-3 border-t border-[#2A211B] flex-shrink-0 mt-auto"
          >
            <input
              type="text"
              aria-label="Message"
              placeholder="Message"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              className="flex-1 box-border bg-[#1A1512] border border-[#3A2E26] rounded-xl px-4 py-3 text-[#F3E9DC] text-[15px] font-ui placeholder-[#A89B8C] focus:outline-none focus:border-[#FF9F1C] transition-colors"
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
        <div className="flex-1 flex flex-col justify-between py-4 min-h-0 overflow-hidden">
          <div className="flex-1 space-y-3 overflow-y-auto min-h-0 pr-1">
            {queue.length === 0 ? (
              <div className="py-8 text-center text-sm text-[#A89B8C]">
                The playlist queue is empty. Add a film to watch next!
              </div>
            ) : (
              queue.map((item, idx) => (
                <div
                  key={item.id || idx}
                  className="flex items-center justify-between p-3.5 bg-[#1A1512] border border-[#2A211B] rounded-xl"
                >
                  <div className="min-w-0 pr-2">
                    <div className="font-bold text-[15px] text-[#F3E9DC] truncate">{item.title}</div>
                    <div className="text-xs text-[#A89B8C] mt-0.5">
                      {item.addedByUserName ? `Added by ${item.addedByUserName}` : 'Catalogue'}
                    </div>
                  </div>
                  {idx === 0 ? (
                    <span className="text-xs font-mono text-[#FF9F1C] bg-[#261E19] px-2.5 py-1 rounded-lg flex-shrink-0">
                      Playing
                    </span>
                  ) : (
                    <span className="text-xs font-mono text-[#A89B8C] bg-[#261E19] px-2.5 py-1 rounded-lg flex-shrink-0">
                      #{idx + 1}
                    </span>
                  )}
                </div>
              ))
            )}

            {/* Movie picker dropdown when adding */}
            {showMoviePicker && (
              <div className="p-3 bg-[#1A1512] border border-[#FF9F1C] rounded-xl space-y-2 mt-2">
                <div className="text-xs font-mono text-[#FF9F1C] uppercase tracking-wider mb-1">
                  Select a film to queue:
                </div>
                {MOVIE_CATALOGUE.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => handleSelectMovieToAdd(m.id)}
                    className="w-full text-left p-2.5 rounded-lg bg-[#261E19] hover:bg-[#3A2E26] text-sm text-[#F3E9DC] flex justify-between items-center transition-colors border-none cursor-pointer"
                  >
                    <span className="font-medium truncate">{m.title}</span>
                    <span className="text-xs text-[#A89B8C] font-mono ml-2">
                      {m.runtime || 10}m
                    </span>
                  </button>
                ))}
              </div>

            )}
          </div>

          <button
            type="button"
            onClick={() => setShowMoviePicker(!showMoviePicker)}
            className="w-full mt-4 py-3 text-center border-[1.5px] border-[#5A4A3E] hover:border-[#FF9F1C] hover:text-[#FF9F1C] text-[#F3E9DC] rounded-full text-[15px] transition-colors cursor-pointer bg-transparent flex-shrink-0"
          >
            {showMoviePicker ? 'Cancel' : 'Add movie'}
          </button>
        </div>
      )}

      {/* TAB 3: POLLS */}
      {activeTab === 'polls' && (
        <div className="flex-1 flex flex-col justify-between py-4 min-h-0 overflow-hidden">
          <div className="flex-1 space-y-4 overflow-y-auto min-h-0 pr-1">
            {activePoll ? (
              <div className="space-y-3">
                <div className="font-bold text-[15px] text-[#F3E9DC]">
                  {activePoll.question}
                </div>
                {activePoll.options.map((opt, idx) => {
                  const pct =
                    totalPollVotes > 0 ? Math.round((opt.votes / totalPollVotes) * 100) : 0;
                  const isSelected = votedOptionId === opt.id;

                  return (
                    <div
                      key={opt.id || idx}
                      onClick={() => handleVote(activePoll.id, opt.id, idx)}
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
                        <span className="font-mono text-xs text-[#A89B8C] ml-2">
                          {pct}% ({opt.votes})
                        </span>
                      </div>
                    </div>
                  );
                })}
                <div className="text-xs text-[#A89B8C] font-mono text-center pt-2">
                  {totalPollVotes} vote{totalPollVotes === 1 ? '' : 's'}
                </div>
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-sm text-[#A89B8C] mb-4">No active poll right now.</p>
                {!showCreatePoll ? (
                  <button
                    type="button"
                    onClick={() => setShowCreatePoll(true)}
                    className="border border-[#5A4A3E] hover:border-[#FF9F1C] text-[#F3E9DC] hover:text-[#FF9F1C] px-4 py-2 rounded-full text-xs font-mono transition-colors bg-transparent cursor-pointer"
                  >
                    + Create a poll
                  </button>
                ) : (
                  <form onSubmit={handleCreatePollSubmit} className="text-left space-y-2.5 p-3.5 bg-[#1A1512] border border-[#2A211B] rounded-xl">
                    <div className="text-xs font-mono text-[#FF9F1C] uppercase">New Audience Poll</div>
                    <input
                      type="text"
                      placeholder="What should we screen next?"
                      value={newPollQuestion}
                      onChange={(e) => setNewPollQuestion(e.target.value)}
                      className="w-full bg-[#261E19] border border-[#3A2E26] rounded-lg px-3 py-2 text-xs text-[#F3E9DC] focus:outline-none focus:border-[#FF9F1C]"
                    />
                    <input
                      type="text"
                      placeholder="Option 1"
                      value={newOption1}
                      onChange={(e) => setNewOption1(e.target.value)}
                      className="w-full bg-[#261E19] border border-[#3A2E26] rounded-lg px-3 py-2 text-xs text-[#F3E9DC] focus:outline-none focus:border-[#FF9F1C]"
                    />
                    <input
                      type="text"
                      placeholder="Option 2"
                      value={newOption2}
                      onChange={(e) => setNewOption2(e.target.value)}
                      className="w-full bg-[#261E19] border border-[#3A2E26] rounded-lg px-3 py-2 text-xs text-[#F3E9DC] focus:outline-none focus:border-[#FF9F1C]"
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
            )}
          </div>
        </div>
      )}
    </aside>
  );
}

