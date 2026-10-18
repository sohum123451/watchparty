'use client';

/**
 * SourcePickerSheet Component — Cinematheque Streaming & OTT Hub
 * 1. Netflix Party Hub (Stranger Things, Squid Game, Money Heist, Wednesday, Extraction 2)
 * 2. JioHotstar Hub (Special OPS, The Night Manager, Loki, Avengers: Endgame, Brahmāstra)
 * 3. YouTube Full Movies & Live Search (Kung Fury, Night of the Living Dead, Charade, The General)
 * 4. Free Cinema Master Prints (Sintel, Tears of Steel, Big Buck Bunny)
 * 5. Paste Link (YouTube, Vimeo, MP4, HLS, Podcasts)
 * 6. Local File Sync
 */

import React, { useState, useEffect } from 'react';
import {
  MOVIE_CATALOGUE,
  NETFLIX_CATALOGUE,
  HOTSTAR_CATALOGUE,
  YOUTUBE_FULL_MOVIES,
  Movie,
} from '@watchparty/shared';
import {
  CloseIcon,
  PlayIcon,
  TvIcon,
  StarIcon,
  FolderIcon,
  FilmIcon,
  GlobeOriginIcon,
  SearchIcon,
} from '@/components/icons/CinemaIcons';

export interface SourceSelection {
  videoId: string;
  provider?: 'html5' | 'youtube' | 'vimeo' | 'local' | 'screenshare';
  sourceRef?: string;
  title: string;
}

export interface SourcePickerSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectSource: (source: SourceSelection) => void;
  onAddToQueue?: (source: SourceSelection) => void;
  onStartScreenShare?: () => void;
  roomCode: string;
  initialTab?: TabType;
}

export type TabType = 'youtube' | 'library' | 'netflix' | 'hotstar' | 'prime' | 'disney' | 'max' | 'link' | 'local';

export function SourcePickerSheet({
  isOpen,
  onClose,
  onSelectSource,
  onAddToQueue,
  onStartScreenShare,
  roomCode,
  initialTab = 'youtube',
}: SourcePickerSheetProps) {
  const [activeTab, setActiveTab] = useState<TabType>(initialTab);

  useEffect(() => {
    if (isOpen && initialTab) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

  // Paste link state
  const [urlInput, setUrlInput] = useState('');
  const [resolving, setResolving] = useState(false);
  const [resolvedSource, setResolvedSource] = useState<any>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);

  // YouTube search query state
  const [ytSearchQuery, setYtSearchQuery] = useState('');
  const [liveResults, setLiveResults] = useState<any[]>([]);
  const [searchingLive, setSearchingLive] = useState(false);

  useEffect(() => {
    if (!ytSearchQuery.trim()) {
      setLiveResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearchingLive(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(ytSearchQuery.trim())}&provider=youtube`);
        if (res.ok) {
          const data = await res.json();
          setLiveResults(data.results || []);
        }
      } catch (err) {
        console.warn('[YouTube Search] Failed:', err);
      } finally {
        setSearchingLive(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [ytSearchQuery]);

  // Local file state
  const [localFileName, setLocalFileName] = useState<string | null>(null);
  const [localFileFingerprint, setLocalFileFingerprint] = useState<string | null>(null);
  const [localFileObjectUrl, setLocalFileObjectUrl] = useState<string | null>(null);

  // Dynamic Free Library from Server API
  const [libraryFilms, setLibraryFilms] = useState<any[]>(() =>
    MOVIE_CATALOGUE.filter((m) => m.isFree === true)
  );
  const [libraryLoading, setLibraryLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLibraryLoading(true);
    fetch('/api/catalogue')
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then((data) => {
        if (!cancelled && data?.films && data.films.length > 0) {
          setLibraryFilms(data.films.filter((m: any) => m.isFree === true));
        }
      })
      .catch(() => {
        // Keeps fallback
      })
      .finally(() => {
        if (!cancelled) setLibraryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleResolveUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanUrl = urlInput.trim();
    if (!cleanUrl) return;

    setResolving(true);
    setResolveError(null);
    setResolvedSource(null);

    // Direct YouTube Detection
    const ytMatch = cleanUrl.match(
      /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))([\w-]{11})/
    );
    if (ytMatch) {
      const vid = ytMatch[1];
      setResolvedSource({
        videoId: vid,
        provider: 'youtube',
        sourceRef: `https://www.youtube.com/watch?v=${vid}`,
        title: `YouTube (${vid})`,
        thumbnail: `https://img.youtube.com/vi/${vid}/hqdefault.jpg`,
      });
      setResolving(false);
      return;
    }

    // Direct MP4 / WebM / HLS
    const isDirectVideo = cleanUrl.match(/\.(mp4|webm|m3u8|mov|ogg)($|\?)/i);
    if (isDirectVideo) {
      const fileName = cleanUrl.split('/').pop()?.split('?')[0] || 'Web Video Stream';
      setResolvedSource({
        videoId: `stream_${Date.now()}`,
        provider: 'html5',
        sourceRef: cleanUrl,
        title: decodeURIComponent(fileName),
      });
      setResolving(false);
      return;
    }

    try {
      const res = await fetch('/api/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: cleanUrl }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || `Resolution failed (${res.status})`);
      }
      setResolvedSource(data.descriptor || data);
    } catch (err: any) {
      setResolveError(err.message || 'Could not resolve URL');
    } finally {
      setResolving(false);
    }
  };

  const handleApplyResolved = (asQueue = false) => {
    if (!resolvedSource) return;
    const provider =
      resolvedSource.provider === 'youtube'
        ? 'youtube'
        : resolvedSource.provider === 'vimeo'
        ? 'vimeo'
        : 'html5';

    const source: SourceSelection = {
      videoId: resolvedSource.sourceRef || `url_${Date.now()}`,
      provider,
      sourceRef: resolvedSource.sourceRef || urlInput.trim(),
      title: resolvedSource.title || 'Web Stream',
    };

    if (asQueue && onAddToQueue) {
      onAddToQueue(source);
    } else {
      onSelectSource(source);
      onClose();
    }
  };

  const handleSelectMovie = (movie: Movie) => {
    const provider = movie.provider === 'youtube' || movie.youtubeId ? 'youtube' : 'html5';
    const sourceRef = movie.youtubeId
      ? `https://www.youtube.com/watch?v=${movie.youtubeId}`
      : movie.videoUrl || movie.playableUrl;

    onSelectSource({
      videoId: movie.youtubeId || movie.id,
      provider,
      sourceRef,
      title: movie.title,
    });
    onClose();
  };

  const handleLocalFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const objUrl = URL.createObjectURL(file);
    const fingerprint = `${file.name}-${file.size}-${file.lastModified}`;
    setLocalFileName(file.name);
    setLocalFileFingerprint(fingerprint);
    setLocalFileObjectUrl(objUrl);
  };

  const handleApplyLocalFile = () => {
    if (!localFileName || !localFileObjectUrl) return;
    onSelectSource({
      videoId: `local_${localFileFingerprint || Date.now()}`,
      provider: 'local',
      sourceRef: localFileObjectUrl,
      title: localFileName,
    });
    onClose();
  };

  const handleOpenPlatformUrl = (url?: string) => {
    if (!url) return;
    const roomParam = encodeURIComponent(roomCode);
    const targetUrl = url.includes('?') ? `${url}&watchparty=${roomParam}` : `${url}#watchparty=${roomParam}`;
    window.open(targetUrl, '_blank', 'noopener,noreferrer');
  };

  const handleSearchYouTube = (e: React.FormEvent) => {
    e.preventDefault();
    const q = ytSearchQuery.trim();
    if (!q) return;

    const ytMatch = q.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))([\w-]{11})/);
    if (ytMatch) {
      const vid = ytMatch[1];
      onSelectSource({
        videoId: vid,
        provider: 'youtube',
        sourceRef: `https://www.youtube.com/watch?v=${vid}`,
        title: `YouTube (${vid})`,
      });
      onClose();
      return;
    }

    // Direct user to YouTube search results to easily pick any video
    window.open(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`, '_blank');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-4xl bg-[#1A1512] border-2 border-[#3A2E26] rounded-2xl shadow-[0_25px_60px_rgba(0,0,0,0.9)] overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#3A2E26] bg-[#0E0B09]">
          <div className="flex items-center gap-2.5">
            <span className="w-3 h-3 rounded-full bg-[#FF9F1C]" />
            <h2 className="font-display font-semibold text-xl sm:text-2xl text-[#F3E9DC]">
              Select What to Watch
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[36px] min-w-[36px] rounded-full bg-[#261E19] hover:bg-[#342821] text-[#A89B8C] hover:text-[#F3E9DC] flex items-center justify-center transition-colors border-none cursor-pointer"
            aria-label="Close dialog"
          >
            <CloseIcon size={16} />
          </button>
        </div>

        {/* Tab switcher */}
        <div className="flex border-b border-[#3A2E26] bg-[#140F0C] px-6 pt-3 gap-2 sm:gap-4 overflow-x-auto select-none">
          {[
            { id: 'youtube', label: 'YouTube', icon: <PlayIcon size={14} className="text-[#FF9F1C]" /> },
            { id: 'library', label: 'Free Cinema', icon: <FilmIcon size={14} className="text-[#2EC4B6]" /> },
            { id: 'netflix', label: 'Netflix', icon: <FilmIcon size={14} className="text-[#E50914]" /> },
            { id: 'hotstar', label: 'JioHotstar', icon: <TvIcon size={14} className="text-[#0063E5]" /> },
            { id: 'prime', label: 'Prime Video', icon: <TvIcon size={14} className="text-[#00A8E1]" /> },
            { id: 'disney', label: 'Disney+', icon: <TvIcon size={14} className="text-[#113CCF]" /> },
            { id: 'max', label: 'Max', icon: <TvIcon size={14} className="text-[#002BE7]" /> },
            { id: 'link', label: 'Web / Drive', icon: <GlobeOriginIcon size={14} className="text-[#FF9F1C]" /> },
            { id: 'local', label: 'Local File', icon: <FolderIcon size={14} className="text-[#A89B8C]" /> },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as TabType)}
              className={`min-h-[36px] pb-2.5 text-xs sm:text-sm font-medium border-b-2 transition-colors cursor-pointer bg-transparent whitespace-nowrap flex items-center gap-1.5 ${
                activeTab === tab.id
                  ? 'border-[#FF9F1C] text-[#FF9F1C] font-bold'
                  : 'border-transparent text-[#A89B8C] hover:text-[#F3E9DC]'
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {/* Content Area */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1 font-ui space-y-4">
          {/* TAB: NETFLIX */}
          {activeTab === 'netflix' && (
            <div className="space-y-4">
              <div className="p-4 bg-[#E50914]/10 border border-[#E50914]/30 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
                <div>
                  <span className="font-bold text-[#E50914] text-sm block mb-1">
                    Netflix Co-Watching Lounge
                  </span>
                  <span className="text-[#A89B8C] leading-relaxed block">
                    Choose a Netflix title below. You can either stream your Netflix browser tab directly into the auditorium with audio, or launch with extension sync!
                  </span>
                </div>
                {onStartScreenShare && (
                  <button
                    type="button"
                    onClick={() => {
                      onStartScreenShare();
                      onClose();
                    }}
                    className="min-h-[36px] px-4 py-2 bg-[#E50914] hover:brightness-110 active:scale-95 text-[#F3E9DC] font-bold text-xs rounded-full whitespace-nowrap transition-all border-none cursor-pointer flex-shrink-0 flex items-center gap-1.5"
                  >
                    <TvIcon size={14} />
                    <span>Stream Netflix Tab</span>
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {NETFLIX_CATALOGUE.map((movie) => (
                  <div
                    key={movie.id}
                    className="bg-[#261E19] border border-[#3A2E26] hover:border-[#E50914] rounded-xl overflow-hidden flex flex-col justify-between transition-all group"
                  >
                    <div className="relative aspect-video bg-black overflow-hidden">
                      <img
                        src={movie.posterUrl}
                        alt={movie.title}
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = 'https://images.unsplash.com/photo-1574375927938-d5a98e8ffe85?w=600&auto=format&fit=crop';
                        }}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 opacity-80"
                      />
                      <span className="absolute top-2 left-2 bg-[#E50914] text-white text-[10px] font-bold px-2 py-0.5 rounded uppercase">
                        Netflix
                      </span>
                      <span className="absolute top-2 right-2 bg-black/70 backdrop-blur-sm text-[#FF9F1C] text-[10px] font-mono px-2 py-0.5 rounded flex items-center gap-1">
                        <StarIcon size={10} className="fill-current" /> {movie.rating}
                      </span>
                    </div>

                    <div className="p-4 flex-1 flex flex-col justify-between">
                      <div>
                        <h3 className="font-display font-semibold text-lg text-[#F3E9DC] leading-snug">
                          {movie.title}
                        </h3>
                        <p className="text-xs text-[#A89B8C] mt-1.5 line-clamp-2">
                          {movie.description}
                        </p>
                        <div className="mt-2 flex items-center gap-2 text-[11px] font-mono text-[#5A4A3E]">
                          <span>{movie.year}</span>
                          <span>•</span>
                          <span>{movie.runtime}m</span>
                          <span>•</span>
                          <span className="text-[#A89B8C]">{movie.genres?.join(', ')}</span>
                        </div>
                      </div>

                      <div className="mt-4 pt-3 border-t border-[#3A2E26] flex flex-col gap-2">
                        <button
                          type="button"
                          onClick={() => handleSelectMovie(movie)}
                          className="w-full min-h-[36px] py-2 bg-[#FF9F1C] hover:brightness-105 active:scale-95 text-[#0E0B09] font-bold text-xs rounded-lg transition-all border-none cursor-pointer flex items-center justify-center gap-1.5"
                        >
                          <PlayIcon size={12} />
                          <span>Watch in Suite</span>
                        </button>
                        <div className="flex gap-2">
                          {onStartScreenShare && (
                            <button
                              type="button"
                              onClick={() => {
                                onStartScreenShare();
                                onClose();
                              }}
                              className="flex-1 min-h-[36px] py-1.5 bg-[#2EC4B6]/15 hover:bg-[#2EC4B6]/25 border border-[#2EC4B6]/40 text-[#2EC4B6] font-medium text-xs rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1"
                              title="Stream your active Netflix browser tab with audio"
                            >
                              <TvIcon size={12} />
                              <span>Stream Tab</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleOpenPlatformUrl(movie.platformUrl)}
                            className="flex-1 min-h-[36px] py-1.5 bg-[#1A1512] hover:bg-[#342821] border border-[#3A2E26] text-[#A89B8C] hover:text-[#F3E9DC] text-xs rounded-lg transition-all cursor-pointer flex items-center justify-center"
                          >
                            ↗ Netflix
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB: JIOHOTSTAR */}
          {activeTab === 'hotstar' && (
            <div className="space-y-4">
              <div className="p-4 bg-[#0063E5]/10 border border-[#0063E5]/30 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
                <div>
                  <span className="font-bold text-[#0063E5] text-sm block mb-1">
                    JioHotstar &amp; Disney+ Hub
                  </span>
                  <span className="text-[#A89B8C] leading-relaxed block">
                    Watch the best of Indian originals, Disney+ blockbusters, and Marvel in perfect sync with your friends!
                  </span>
                </div>
                {onStartScreenShare && (
                  <button
                    type="button"
                    onClick={() => {
                      onStartScreenShare();
                      onClose();
                    }}
                    className="min-h-[36px] px-4 py-2 bg-[#0063E5] hover:brightness-110 active:scale-95 text-[#F3E9DC] font-bold text-xs rounded-full whitespace-nowrap transition-all border-none cursor-pointer flex-shrink-0 flex items-center gap-1.5"
                  >
                    <TvIcon size={14} />
                    <span>Stream Hotstar Tab</span>
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {HOTSTAR_CATALOGUE.map((movie) => (
                  <div
                    key={movie.id}
                    className="bg-[#261E19] border border-[#3A2E26] hover:border-[#0063E5] rounded-xl overflow-hidden flex flex-col justify-between transition-all group"
                  >
                    <div className="relative aspect-video bg-black overflow-hidden">
                      <img
                        src={movie.posterUrl}
                        alt={movie.title}
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=600&auto=format&fit=crop';
                        }}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 opacity-80"
                      />
                      <span className="absolute top-2 left-2 bg-[#0063E5] text-white text-[10px] font-bold px-2 py-0.5 rounded uppercase">
                        Hotstar
                      </span>
                      <span className="absolute top-2 right-2 bg-black/70 backdrop-blur-sm text-[#FF9F1C] text-[10px] font-mono px-2 py-0.5 rounded flex items-center gap-1">
                        <StarIcon size={10} className="fill-current" /> {movie.rating}
                      </span>
                    </div>

                    <div className="p-4 flex-1 flex flex-col justify-between">
                      <div>
                        <h3 className="font-display font-semibold text-lg text-[#F3E9DC] leading-snug">
                          {movie.title}
                        </h3>
                        <p className="text-xs text-[#A89B8C] mt-1.5 line-clamp-2">
                          {movie.description}
                        </p>
                        <div className="mt-2 flex items-center gap-2 text-[11px] font-mono text-[#5A4A3E]">
                          <span>{movie.year}</span>
                          <span>•</span>
                          <span>{movie.runtime}m</span>
                          <span>•</span>
                          <span className="text-[#A89B8C]">{movie.genres?.join(', ')}</span>
                        </div>
                      </div>

                      <div className="mt-4 pt-3 border-t border-[#3A2E26] flex flex-col gap-2">
                        <button
                          type="button"
                          onClick={() => handleSelectMovie(movie)}
                          className="w-full py-2 bg-[#FF9F1C] hover:brightness-105 active:scale-95 text-[#0E0B09] font-bold text-xs rounded-lg transition-all border-none cursor-pointer flex items-center justify-center gap-1.5"
                        >
                          <span>▶</span>
                          <span>Watch Preview in Room</span>
                        </button>
                        <div className="flex gap-2">
                          {onStartScreenShare && (
                            <button
                              type="button"
                              onClick={() => {
                                onStartScreenShare();
                                onClose();
                              }}
                              className="flex-1 py-1.5 bg-[#2EC4B6]/15 hover:bg-[#2EC4B6]/25 border border-[#2EC4B6]/40 text-[#2EC4B6] font-medium text-xs rounded-lg transition-all cursor-pointer"
                              title="Stream your active Hotstar tab with audio"
                            >
                              📺 Stream Tab
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleOpenPlatformUrl(movie.platformUrl)}
                            className="flex-1 py-1.5 bg-[#1A1512] hover:bg-[#342821] border border-[#3A2E26] text-[#A89B8C] hover:text-[#F3E9DC] text-xs rounded-lg transition-all cursor-pointer"
                          >
                            ↗ Hotstar
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB: YOUTUBE FULL MOVIES & LIVE SEARCH */}
          {activeTab === 'youtube' && (
            <div className="space-y-4">
              <form onSubmit={handleSearchYouTube} className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type="text"
                    placeholder="Search ANY YouTube movie, trailer, video, or paste link…"
                    value={ytSearchQuery}
                    onChange={(e) => setYtSearchQuery(e.target.value)}
                    className="w-full bg-[#261E19] border border-[#3A2E26] rounded-xl px-4 py-3 text-sm text-[#F3E9DC] placeholder-[#5A4A3E] focus:outline-none focus:border-[#FF9F1C]"
                  />
                  {searchingLive && (
                    <span className="absolute right-3 top-3.5 text-xs text-[#FF9F1C] font-mono animate-pulse">
                      Searching...
                    </span>
                  )}
                </div>
                <button
                  type="submit"
                  className="min-h-[36px] bg-[#E4572E] hover:brightness-105 active:scale-95 text-[#0E0B09] font-bold text-sm px-5 py-3 rounded-xl transition-all border-none cursor-pointer flex items-center gap-1.5"
                >
                  <SearchIcon size={14} />
                  <span>Search</span>
                </button>
              </form>

              {/* Live search results */}
              {liveResults.length > 0 && (
                <div className="pt-2">
                  <h3 className="font-mono text-xs uppercase tracking-wider text-[#FF9F1C] mb-3">
                    Search Results ({liveResults.length})
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {liveResults.map((item) => (
                      <div
                        key={item.id}
                        className="bg-[#261E19] border border-[#3A2E26] hover:border-[#FF9F1C] rounded-xl p-3 flex flex-col justify-between transition-all"
                      >
                        <div className="relative aspect-video bg-black rounded-lg overflow-hidden mb-2">
                          <img
                            src={item.thumbnail}
                            alt={item.title}
                            className="w-full h-full object-cover"
                          />
                          <span className="absolute bottom-1.5 right-1.5 bg-black/80 font-mono text-[10px] text-[#FF9F1C] px-1.5 py-0.5 rounded">
                            {Math.round(item.durationMs / 60000)}m
                          </span>
                        </div>
                        <div>
                          <h4 className="font-display font-medium text-xs text-[#F3E9DC] line-clamp-1">
                            {item.title}
                          </h4>
                          <p className="text-[10px] text-[#A89B8C] mt-0.5">{item.channel}</p>
                        </div>
                        <div className="flex items-center gap-2 mt-3">
                          <button
                            type="button"
                            onClick={() => {
                              onSelectSource({
                                videoId: item.id,
                                provider: 'youtube',
                                sourceRef: item.sourceUrl,
                                title: item.title,
                              });
                              onClose();
                            }}
                            className="flex-1 min-h-[36px] py-1.5 px-3 bg-[#FF9F1C] hover:bg-[#FFAE38] text-[#0E0B09] font-mono font-bold text-xs rounded transition-all text-center cursor-pointer"
                          >
                            Play Now
                          </button>
                          {onAddToQueue && (
                            <button
                              type="button"
                              onClick={() => {
                                onAddToQueue({
                                  videoId: item.id,
                                  provider: 'youtube',
                                  sourceRef: item.sourceUrl,
                                  title: item.title,
                                });
                              }}
                              className="min-h-[36px] py-1.5 px-3 bg-[#1A1512] hover:bg-[#342821] border border-[#3A2E26] text-[#F3E9DC] font-mono text-xs rounded transition-all cursor-pointer"
                            >
                              + Queue
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="pt-2">
                <h3 className="font-mono text-xs uppercase tracking-wider text-[#FF9F1C] mb-3">
                  Featured Full-Length Movies (100% Free on YouTube)
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {YOUTUBE_FULL_MOVIES.map((movie) => (
                    <div
                      key={movie.id}
                      onClick={() => handleSelectMovie(movie)}
                      className="bg-[#261E19] hover:bg-[#2F251F] border border-[#3A2E26] hover:border-[#E4572E] rounded-xl overflow-hidden cursor-pointer transition-all flex flex-col justify-between group"
                    >
                      <div className="relative aspect-video bg-black overflow-hidden">
                        <img
                          src={movie.posterUrl}
                          alt={movie.title}
                          onError={(e) => {
                            const img = e.target as HTMLImageElement;
                            if (movie.youtubeId) {
                              img.src = `https://img.youtube.com/vi/${movie.youtubeId}/hqdefault.jpg`;
                            } else {
                              img.src = 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=600&auto=format&fit=crop';
                            }
                          }}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 opacity-80"
                        />
                        <span className="absolute bottom-2 right-2 bg-black/80 font-mono text-[10px] text-[#F3E9DC] px-2 py-0.5 rounded">
                          {movie.runtime}m
                        </span>
                        <span className="absolute top-2 left-2 bg-[#E4572E] text-white text-[9px] font-bold px-1.5 py-0.5 rounded uppercase">
                          Full Movie
                        </span>
                      </div>
                      <div className="p-3">
                        <h4 className="font-display font-medium text-sm text-[#F3E9DC] group-hover:text-[#FF9F1C] transition-colors line-clamp-1">
                          {movie.title}
                        </h4>
                        <p className="text-[11px] text-[#A89B8C] line-clamp-2 mt-1">
                          {movie.description}
                        </p>
                        <div className="mt-3 py-1.5 bg-[#FF9F1C] text-[#0E0B09] font-bold text-xs rounded text-center">
                          Play Full Movie
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB: FREE CINEMA LIBRARY */}
          {activeTab === 'library' && (
            <div className="space-y-3">
              {libraryLoading && libraryFilms.length === 0 ? (
                <div className="text-center py-8 text-sm font-mono text-[#A89B8C]">
                  Loading library catalogue…
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {libraryFilms.map((movie) => (
                    <div
                      key={movie.id}
                      onClick={() => handleSelectMovie(movie)}
                      className="bg-[#261E19] hover:bg-[#2F251F] border border-[#3A2E26] hover:border-[#FF9F1C] p-4 rounded-xl flex flex-col justify-between cursor-pointer transition-all group"
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="font-display font-semibold text-lg text-[#F3E9DC] group-hover:text-[#FF9F1C] transition-colors leading-tight">
                            {movie.title}
                          </h3>
                          <span className="font-mono text-[10px] bg-[#0E0B09] text-[#2EC4B6] border border-[#2EC4B6]/30 px-2 py-0.5 rounded-full uppercase whitespace-nowrap">
                            {movie.license ? movie.license.split('(')[0].trim() : 'Free'}
                          </span>
                        </div>
                        <p className="text-xs text-[#A89B8C] mt-2 line-clamp-2">{movie.description}</p>
                        {movie.attribution && (
                          <div className="text-[10px] font-mono text-[#FF9F1C]/80 mt-1.5 truncate">
                            Attribution: {movie.attribution}
                          </div>
                        )}
                      </div>
                      <div className="mt-3 flex items-center justify-between text-[11px] font-mono text-[#5A4A3E]">
                        <span>{movie.runtime ? `${movie.runtime}m` : ''} {movie.year ? `(${movie.year})` : ''}</span>
                        <span>{movie.genre || (Array.isArray(movie.genres) ? movie.genres[0] : '')}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB: PASTE A LINK */}
          {activeTab === 'link' && (
            <div className="space-y-4">
              <form onSubmit={handleResolveUrl} className="flex gap-2">
                <input
                  type="url"
                  placeholder="Paste YouTube, Vimeo, direct MP4, podcast, or stream link…"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  className="flex-1 bg-[#261E19] border border-[#3A2E26] rounded-xl px-4 py-3 text-sm text-[#F3E9DC] placeholder-[#5A4A3E] focus:outline-none focus:border-[#FF9F1C]"
                />
                <button
                  type="submit"
                  disabled={resolving || !urlInput.trim()}
                  className="bg-[#FF9F1C] hover:brightness-105 active:scale-95 text-[#0E0B09] font-bold text-sm px-5 py-3 rounded-xl transition-all border-none cursor-pointer disabled:opacity-50"
                >
                  {resolving ? 'Resolving…' : 'Inspect'}
                </button>
              </form>

              {resolveError && (
                <div className="p-3 bg-[#E4572E]/15 border border-[#E4572E]/40 rounded-lg text-xs font-mono text-[#E4572E]">
                  {resolveError}
                </div>
              )}

              {resolvedSource && (
                <div className="bg-[#261E19] border border-[#3A2E26] rounded-xl p-5 space-y-3">
                  <div className="flex gap-4 items-start">
                    {resolvedSource.thumbnail && (
                      <img
                        src={resolvedSource.thumbnail}
                        alt="Preview"
                        className="w-28 aspect-video object-cover rounded-lg border border-[#3A2E26]"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <span className="font-mono text-[10px] text-[#FF9F1C] uppercase tracking-wider block">
                        {resolvedSource.provider || resolvedSource.kind}
                      </span>
                      <h4 className="font-display font-semibold text-lg text-[#F3E9DC] truncate">
                        {resolvedSource.title}
                      </h4>
                      {resolvedSource.author && (
                        <p className="text-xs text-[#A89B8C]">By {resolvedSource.author}</p>
                      )}
                    </div>
                  </div>

                  <p className="text-[11px] font-mono text-[#A89B8C] border-t border-[#3A2E26] pt-2">
                    Attribution: Content streams directly from origin. WatchParty does not rehost third-party media.
                  </p>

                  <div className="flex gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => handleApplyResolved(false)}
                      className="flex-1 py-2.5 bg-[#FF9F1C] text-[#0E0B09] font-bold text-sm rounded-lg hover:brightness-105 active:scale-95 transition-all border-none cursor-pointer"
                    >
                      Play in room now
                    </button>
                    {onAddToQueue && (
                      <button
                        type="button"
                        onClick={() => handleApplyResolved(true)}
                        className="px-4 py-2.5 bg-[#1A1512] border border-[#3A2E26] hover:border-[#FF9F1C] text-[#F3E9DC] text-sm rounded-lg transition-colors cursor-pointer"
                      >
                        + Add to queue
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB: LOCAL FILE */}
          {activeTab === 'local' && (
            <div className="space-y-4">
              <div className="border-2 border-dashed border-[#3A2E26] rounded-xl p-8 text-center hover:border-[#FF9F1C] transition-colors bg-[#261E19]/40">
                <input
                  type="file"
                  accept="video/*,audio/*"
                  onChange={handleLocalFileChange}
                  className="hidden"
                  id="local-file-picker"
                />
                <label htmlFor="local-file-picker" className="cursor-pointer block space-y-2">
                  <div className="w-12 h-12 mx-auto rounded-full bg-[#3A2E26]/60 flex items-center justify-center text-xl text-[#FF9F1C]">
                    <FolderIcon size={24} />
                  </div>
                  <div className="text-sm font-medium text-[#F3E9DC]">
                    {localFileName ? localFileName : 'Select a local video file from your computer'}
                  </div>
                  <div className="text-xs font-mono text-[#A89B8C]">
                    MP4, WebM, MKV, or MOV
                  </div>
                </label>
              </div>

              {localFileName && (
                <div className="bg-[#261E19] border border-[#3A2E26] rounded-xl p-4 space-y-2">
                  <div className="flex justify-between items-center text-xs font-mono">
                    <span className="text-[#A89B8C]">File Fingerprint:</span>
                    <span className="text-[#2EC4B6] truncate max-w-[240px]">{localFileFingerprint}</span>
                  </div>
                  <p className="text-xs text-[#A89B8C]">
                    Each friend in the room opens their own identical copy of this file. Play, pause, and seek will stay synchronized automatically without uploading any data.
                  </p>
                  <button
                    type="button"
                    onClick={handleApplyLocalFile}
                    className="w-full py-2.5 bg-[#FF9F1C] text-[#0E0B09] font-bold text-sm rounded-lg hover:brightness-105 active:scale-95 transition-all border-none cursor-pointer mt-2"
                  >
                    Start local file sync
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
