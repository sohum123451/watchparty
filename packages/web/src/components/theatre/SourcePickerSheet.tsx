'use client';

/**
 * SourcePickerSheet Component — Phase 4
 * Provides a modal/sheet to select media sources:
 * 1. Free library (public domain / open films)
 * 2. Paste a link (YouTube, direct MP4/HLS, podcast RSS, arbitrary site with SSRF protection)
 * 3. Local file (member chooses own copy, matched by fingerprint)
 * 4. Streaming platforms (Netflix, JioHotstar, Prime Video, Disney+, etc.)
 */

import React, { useState, useEffect } from 'react';
import { MOVIE_CATALOGUE } from '@watchparty/shared';

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
  roomCode: string;
}

type TabType = 'library' | 'link' | 'local' | 'platforms';

export function SourcePickerSheet({
  isOpen,
  onClose,
  onSelectSource,
  onAddToQueue,
  roomCode,
}: SourcePickerSheetProps) {
  const [activeTab, setActiveTab] = useState<TabType>('library');

  // Paste link state
  const [urlInput, setUrlInput] = useState('');
  const [resolving, setResolving] = useState(false);
  const [resolvedSource, setResolvedSource] = useState<any>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);

  // Local file state
  const [localFileName, setLocalFileName] = useState<string | null>(null);
  const [localFileFingerprint, setLocalFileFingerprint] = useState<string | null>(null);
  const [localFileObjectUrl, setLocalFileObjectUrl] = useState<string | null>(null);

  // Extension detection state
  const [hasExtension, setHasExtension] = useState(false);

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
          setLibraryFilms(data.films);
        }
      })
      .catch(() => {
        // Keeps fallback to shared MOVIE_CATALOGUE free films
      })
      .finally(() => {
        if (!cancelled) setLibraryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const extDetected = Boolean((window as any).__WATCHPARTY_EXTENSION__);
      setHasExtension(extDetected);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleResolveUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanUrl = urlInput.trim();
    if (!cleanUrl) return;

    setResolving(true);
    setResolveError(null);
    setResolvedSource(null);

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
      setResolvedSource(data);
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
    }
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

  const handleOpenPlatform = (name: string, url: string) => {
    const roomParam = encodeURIComponent(roomCode);
    const targetUrl = url.includes('?') ? `${url}&watchparty=${roomParam}` : `${url}#watchparty=${roomParam}`;
    window.open(targetUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl bg-[#1A1512] border-2 border-[#3A2E26] rounded-xl shadow-[0_25px_50px_rgba(0,0,0,0.8)] overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#3A2E26] bg-[#0E0B09]">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#FF9F1C]" />
            <h2 className="font-display font-semibold text-xl text-[#F3E9DC]">Add source</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-[#261E19] hover:bg-[#342821] text-[#A89B8C] hover:text-[#F3E9DC] flex items-center justify-center transition-colors border-none cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Tab switcher */}
        <div className="flex border-b border-[#3A2E26] bg-[#140F0C] px-6 pt-3 gap-6 overflow-x-auto">
          {[
            { id: 'library', label: 'Free library' },
            { id: 'link', label: 'Paste a link' },
            { id: 'local', label: 'Local file' },
            { id: 'platforms', label: 'Platforms' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as TabType)}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors cursor-pointer bg-transparent whitespace-nowrap ${
                activeTab === tab.id
                  ? 'border-[#FF9F1C] text-[#FF9F1C] font-bold'
                  : 'border-transparent text-[#A89B8C] hover:text-[#F3E9DC]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content Area */}
        <div className="p-6 overflow-y-auto flex-1 font-ui space-y-4">
          {/* TAB 1: Free Library */}
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
                      onClick={() => {
                        onSelectSource({
                          videoId: movie.id,
                          provider: movie.provider || 'html5',
                          sourceRef: movie.videoUrl,
                          title: movie.title,
                        });
                        onClose();
                      }}
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

          {/* TAB 2: Paste a Link */}
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
                    Attribution: Content streams directly from the origin host. WatchParty does not rehost or alter third-party media.
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

          {/* TAB 3: Local File */}
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
                    📁
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

          {/* TAB 4: Streaming Platforms */}
          {activeTab === 'platforms' && (
            <div className="space-y-4">
              {!hasExtension && (
                <div className="p-3.5 bg-[#FF9F1C]/10 border border-[#FF9F1C]/40 rounded-xl flex items-center justify-between gap-3 text-xs">
                  <div>
                    <span className="font-bold text-[#FF9F1C] block">Browser Extension Recommended</span>
                    <span className="text-[#A89B8C]">
                      Install the WatchParty Stream Synchronizer extension to automatically sync playback while using your own legitimate streaming accounts.
                    </span>
                  </div>
                  <a
                    href="/extension"
                    target="_blank"
                    className="px-3 py-1.5 bg-[#FF9F1C] text-[#0E0B09] font-bold text-xs rounded-full whitespace-nowrap hover:brightness-105 transition-all no-underline inline-block flex-shrink-0"
                  >
                    Install extension
                  </a>
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {[
                  { name: 'Netflix', url: 'https://www.netflix.com', color: '#E50914' },
                  { name: 'JioHotstar', url: 'https://www.hotstar.com', color: '#0F1014' },
                  { name: 'Prime Video', url: 'https://www.primevideo.com', color: '#00A8E1' },
                  { name: 'Disney+', url: 'https://www.disneyplus.com', color: '#113CCF' },
                  { name: 'YouTube', url: 'https://www.youtube.com', color: '#FF0000' },
                  { name: 'Max', url: 'https://www.max.com', color: '#002BE7' },
                ].map((plat) => (
                  <button
                    key={plat.name}
                    type="button"
                    onClick={() => handleOpenPlatform(plat.name, plat.url)}
                    className="p-4 bg-[#261E19] hover:bg-[#342821] border border-[#3A2E26] hover:border-[#FF9F1C] rounded-xl text-left transition-all cursor-pointer flex flex-col justify-between min-h-[90px]"
                  >
                    <span className="text-xs font-mono text-[#A89B8C] uppercase tracking-wider">Sync with account</span>
                    <span className="font-display font-semibold text-lg text-[#F3E9DC]">{plat.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
