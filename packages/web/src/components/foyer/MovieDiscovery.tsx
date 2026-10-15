'use client';

/**
 * MovieDiscovery Component
 * Cinema Vault & Discovery interface featuring:
 * 1. Big poster art with warm vignette, format tags, and rating badges
 * 2. Category carousel with momentum drag/wheel scrolling & brass chevron controls
 * 3. Fuzzy search using MovieSearchEngine with anime.js stagger entrance & highlighted matches
 * 4. Genre & format filter chips with smooth layout transitions
 * 5. Interactive "Illuminate Suite" trigger and synopsis preview modal
 */

import React, { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import {
  MOVIE_CATALOGUE,
  MovieSearchEngine,
  Movie,
  MovieFilter,
  MovieCategory,
} from '@watchparty/shared';
import { useAnime } from '@/motion/useAnime';
import { MotionDurations, MotionEasings, MotionStaggers } from '@/motion/tokens';
import { stagger } from 'animejs';

export interface MovieDiscoveryProps {
  onSelectMovieForSuite?: (movie: Movie) => void;
  className?: string;
}

interface CategoryTab {
  id: string;
  label: string;
  filterCategory?: MovieCategory;
  genre?: string;
  badge?: string;
}

const CATEGORIES: CategoryTab[] = [
  { id: 'all', label: 'All Archived Prints' },
  { id: 'trending', label: 'Trending in Foyers', filterCategory: 'trending', badge: 'HOT' },
  { id: 'top_rated', label: 'Criterion & 70mm', filterCategory: 'top_rated', badge: '70mm' },
  { id: 'scifi', label: 'Sci-Fi & Cyberpunk', genre: 'Sci-Fi' },
  { id: 'action', label: 'Pulse Thrillers', genre: 'Action' },
  { id: 'crime', label: 'Crime & Neo-Noir', genre: 'Crime' },
  { id: 'free', label: 'Free to Project', filterCategory: 'free_to_watch', badge: 'OPEN' },
];

const GENRE_CHIPS = ['All', 'Sci-Fi', 'Action', 'Drama', 'Crime', 'Adventure', 'Thriller', 'Animation'];

/**
 * Safely renders text with highlight <mark> tags into styled spans
 */
function HighlightedText({ html, fallback }: { html?: string; fallback: string }) {
  if (!html || !html.includes('<mark>')) {
    return <span>{fallback}</span>;
  }

  const parts = html.split(/(<mark>.*?<\/mark>)/g);
  return (
    <span>
      {parts.map((part, i) => {
        if (part.startsWith('<mark>') && part.endsWith('</mark>')) {
          const content = part.slice(6, -7);
          return (
            <mark
              key={i}
              className="bg-accent/30 text-accent font-semibold px-0.5 rounded-sm not-italic"
            >
              {content}
            </mark>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
}

export function MovieDiscovery({
  onSelectMovieForSuite,
  className = '',
}: MovieDiscoveryProps) {
  const searchEngine = useMemo(() => new MovieSearchEngine(MOVIE_CATALOGUE), []);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedGenre, setSelectedGenre] = useState<string>('All');
  const [previewMovie, setPreviewMovie] = useState<Movie | null>(null);

  // Carousel ref and momentum drag state
  const carouselRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const startXRef = useRef(0);
  const scrollLeftRef = useRef(0);
  const velocityRef = useRef(0);
  const lastXRef = useRef(0);
  const lastTimeRef = useRef(0);
  const momentumRafRef = useRef<number | null>(null);

  // Filtered/searched movies
  const searchResults = useMemo(() => {
    const activeCat = CATEGORIES.find((c) => c.id === selectedCategory);
    const filter: MovieFilter = {};

    if (activeCat?.filterCategory) {
      filter.category = activeCat.filterCategory;
    }

    if (selectedGenre !== 'All') {
      filter.genres = [selectedGenre];
    } else if (activeCat?.genre) {
      filter.genres = [activeCat.genre];
    }

    return searchEngine.search(searchQuery, filter, searchQuery ? 'relevance' : 'rating_desc');
  }, [searchEngine, searchQuery, selectedCategory, selectedGenre]);

  // Anime.js stagger entrance when results change
  const resultsContainerRef = useRef<HTMLDivElement>(null);
  useAnime(
    ({ animate, reducedMotion }) => {
      if (reducedMotion) return;
      animate('.movie-card-entrance', {
        opacity: [0, 1],
        translateY: [16, 0],
        scale: [0.96, 1],
        delay: stagger(MotionStaggers.tight, { start: 20 }),
        duration: MotionDurations.cinematic,
        ease: MotionEasings.snappyOut,
      });
    },
    [searchResults.length, selectedCategory, selectedGenre, searchQuery],
    { containerRef: resultsContainerRef }
  );

  // MOMENTUM CAROUSEL DRAG LOGIC
  const stopMomentum = useCallback(() => {
    if (momentumRafRef.current) {
      cancelAnimationFrame(momentumRafRef.current);
      momentumRafRef.current = null;
    }
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!carouselRef.current) return;
    stopMomentum();
    isDraggingRef.current = true;
    startXRef.current = e.pageX - carouselRef.current.offsetLeft;
    scrollLeftRef.current = carouselRef.current.scrollLeft;
    lastXRef.current = e.pageX;
    lastTimeRef.current = performance.now();
    velocityRef.current = 0;
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDraggingRef.current || !carouselRef.current) return;
    e.preventDefault();
    const x = e.pageX - carouselRef.current.offsetLeft;
    const walk = (x - startXRef.current) * 1.4; // 1.4x responsive pan
    carouselRef.current.scrollLeft = scrollLeftRef.current - walk;

    const now = performance.now();
    const dt = now - lastTimeRef.current;
    if (dt > 10) {
      velocityRef.current = (e.pageX - lastXRef.current) / dt;
      lastXRef.current = e.pageX;
      lastTimeRef.current = now;
    }
  };

  const handleMouseUpOrLeave = () => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;

    // Apply inertia momentum glide
    let currentVel = velocityRef.current * 18;
    const glide = () => {
      if (!carouselRef.current || Math.abs(currentVel) < 0.3) {
        stopMomentum();
        return;
      }
      carouselRef.current.scrollLeft -= currentVel;
      currentVel *= 0.92; // Friction deceleration
      momentumRafRef.current = requestAnimationFrame(glide);
    };
    stopMomentum();
    momentumRafRef.current = requestAnimationFrame(glide);
  };

  const scrollCarousel = (direction: 'left' | 'right') => {
    if (!carouselRef.current) return;
    stopMomentum();
    const scrollAmount = direction === 'left' ? -380 : 380;
    carouselRef.current.scrollBy({ left: scrollAmount, behavior: 'smooth' });
  };

  useEffect(() => {
    return () => stopMomentum();
  }, [stopMomentum]);

  return (
    <section className={`movie-discovery bg-surface border border-border-brass rounded-sm shadow-velvet-raised p-6 ${className}`}>
      {/* 1. SECTION HEADER WITH DISCOVERY CONTROLS */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-5 border-b border-border-brass">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono text-accent uppercase tracking-widest mb-1.5">
            <span className="w-2 h-2 rounded-full bg-accent shadow-projector animate-pulse" />
            <span>Archive Film Vault</span>
            <span className="text-muted">•</span>
            <span className="text-muted">{MOVIE_CATALOGUE.length} Master Prints Available</span>
          </div>
          <h2 className="font-display font-bold text-2xl md:text-3xl text-text">
            Curated Repertory & Streams
          </h2>
        </div>

        {/* FUZZY SEARCH INPUT */}
        <div className="relative w-full md:w-80">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-muted">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search title, director, cast..."
            className="w-full pl-9 pr-8 py-2 bg-bg/90 border border-border-brass rounded-sm font-sans text-sm text-text placeholder-muted focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-all shadow-inner"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute inset-y-0 right-0 pr-3 flex items-center text-xs text-muted hover:text-text cursor-pointer"
              title="Clear search"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* 2. CATEGORY TABS CAROUSEL WITH MOMENTUM CONTROLS */}
      <div className="relative pt-4 pb-2">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5 text-xs font-mono text-muted uppercase tracking-wider">
            <span>Projection Hallways</span>
          </div>
          {/* Brass Chevron Scroll Triggers */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => scrollCarousel('left')}
              className="p-1 px-2 bg-surface-2 hover:bg-surface-3 active:scale-95 border border-border-brass rounded-sm text-xs text-muted hover:text-accent transition-all cursor-pointer shadow-sm"
              title="Scroll Hallways Left"
            >
              ◀
            </button>
            <button
              onClick={() => scrollCarousel('right')}
              className="p-1 px-2 bg-surface-2 hover:bg-surface-3 active:scale-95 border border-border-brass rounded-sm text-xs text-muted hover:text-accent transition-all cursor-pointer shadow-sm"
              title="Scroll Hallways Right"
            >
              ▶
            </button>
          </div>
        </div>

        {/* MOMENTUM SCROLL CONTAINER */}
        <div
          ref={carouselRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUpOrLeave}
          onMouseLeave={handleMouseUpOrLeave}
          className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none select-none cursor-grab active:cursor-grabbing"
          style={{ scrollBehavior: isDraggingRef.current ? 'auto' : 'smooth' }}
        >
          {CATEGORIES.map((cat) => {
            const isActive = selectedCategory === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`flex-shrink-0 px-3.5 py-1.5 rounded-sm font-mono text-xs transition-all flex items-center gap-2 border cursor-pointer active:scale-95 ${
                  isActive
                    ? 'bg-accent text-[#0E0B09] font-bold border-accent shadow-projector'
                    : 'bg-surface-2 text-muted hover:text-text hover:bg-surface-3 border-border-brass'
                }`}
              >
                <span>{cat.label}</span>
                {cat.badge && (
                  <span
                    className={`text-[9px] px-1 py-0.2 rounded font-bold uppercase tracking-wider ${
                      isActive ? 'bg-[#0E0B09] text-accent' : 'bg-surface-3 text-accent border border-accent/30'
                    }`}
                  >
                    {cat.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. GENRE FILTER CHIPS WITH SMOOTH TRANSITION */}
      <div className="flex flex-wrap items-center gap-1.5 py-2 mb-6">
        <span className="text-[11px] font-mono text-muted mr-1.5 uppercase">Genre:</span>
        {GENRE_CHIPS.map((genre) => {
          const isActive = selectedGenre === genre;
          return (
            <button
              key={genre}
              onClick={() => setSelectedGenre(genre)}
              className={`px-2.5 py-1 rounded-sm font-sans text-xs transition-all border cursor-pointer active:scale-95 ${
                isActive
                  ? 'bg-surface-3 border-accent text-accent font-semibold shadow-sm'
                  : 'bg-bg/60 border-border-subtle text-muted hover:text-text hover:border-border-brass'
              }`}
            >
              {genre}
            </button>
          );
        })}
        {(selectedGenre !== 'All' || selectedCategory !== 'all' || searchQuery) && (
          <button
            onClick={() => {
              setSelectedGenre('All');
              setSelectedCategory('all');
              setSearchQuery('');
            }}
            className="ml-auto text-xs font-mono text-accent-2 hover:underline cursor-pointer flex items-center gap-1"
          >
            <span>Reset Filters</span>
          </button>
        )}
      </div>

      {/* 4. BIG POSTER ART MOVIE GRID (ANIMATED STAGGER ENTRANCE) */}
      <div
        ref={resultsContainerRef}
        className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4"
      >
        {searchResults.map((res) => {
          const m = res.movie;
          return (
            <div
              key={m.id}
              className="movie-card-entrance group relative bg-surface-2 border border-border-brass rounded-sm overflow-hidden flex flex-col justify-between hover:border-accent hover:shadow-projector transition-all duration-300"
            >
              {/* BIG POSTER ART */}
              <div className="relative aspect-[2/3] w-full overflow-hidden bg-bg">
                <img
                  src={m.posterUrl}
                  alt={m.title}
                  loading="lazy"
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 ease-out"
                />

                {/* Warm Cinema Vignette */}
                <div className="absolute inset-0 bg-gradient-to-t from-[#0E0B09] via-transparent to-[#0E0B09]/40 opacity-90 group-hover:opacity-75 transition-opacity" />

                {/* Top Badges: Rating & Format */}
                <div className="absolute top-2 left-2 right-2 flex justify-between items-center text-[10px] font-mono">
                  <span className="px-1.5 py-0.5 bg-bg/90 border border-border-brass text-accent font-bold rounded-sm backdrop-blur-sm">
                    ★ {m.rating.toFixed(1)}
                  </span>
                  <span className="px-1.5 py-0.5 bg-bg/80 border border-border-subtle text-muted rounded-sm backdrop-blur-sm uppercase">
                    {m.year}
                  </span>
                </div>

                {/* Hover Reveal: Suite Launch Overlay */}
                <div className="absolute inset-0 bg-bg/85 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex flex-col justify-center items-center p-3 text-center gap-2 backdrop-blur-xs">
                  <button
                    onClick={() => onSelectMovieForSuite?.(m)}
                    className="w-full py-2 px-3 bg-accent hover:bg-accent/90 active:scale-95 text-[#0E0B09] font-mono font-bold text-xs rounded-sm shadow-projector transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/></svg>
                    <span>Project In Suite</span>
                  </button>
                  <button
                    onClick={() => setPreviewMovie(m)}
                    className="w-full py-1.5 px-3 bg-surface-2 hover:bg-surface-3 active:scale-95 text-text border border-border-brass font-mono text-[11px] rounded-sm transition-all cursor-pointer"
                  >
                    Examine Print
                  </button>
                </div>
              </div>

              {/* METADATA: Title, Director, Genres */}
              <div className="p-2.5 flex-1 flex flex-col justify-between">
                <div>
                  <h3 className="font-display font-bold text-sm text-text leading-snug group-hover:text-accent transition-colors line-clamp-1">
                    <HighlightedText html={res.highlightedTitle} fallback={m.title} />
                  </h3>
                  <p className="text-[11px] text-muted font-sans mt-0.5 line-clamp-1">
                    Dir. {m.director}
                  </p>
                </div>

                <div className="mt-2 pt-2 border-t border-border-subtle flex items-center justify-between text-[10px] font-mono text-muted">
                  <span>{m.runtime}m</span>
                  <span className="text-accent/80">{m.genres[0]}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* EMPTY SEARCH STATE (One short line + one button) */}
      {searchResults.length === 0 && (
        <div className="py-12 text-center space-y-3 bg-[#1A1512] border border-[#3A2E26] rounded-xl">
          <h3 className="font-display text-base text-[#F3E9DC]">No movies found</h3>
          <button
            onClick={() => {
              setSearchQuery('');
              setSelectedGenre('All');
              setSelectedCategory('all');
            }}
            className="px-4 py-2 bg-accent text-[#0E0B09] font-bold text-xs rounded-full cursor-pointer hover:brightness-105 active:scale-95 transition-all"
          >
            Reset
          </button>
        </div>
      )}

      {/* 5. MOVIE PREVIEW MODAL */}
      {previewMovie && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-bg/80 backdrop-blur-md">
          <div className="relative w-full max-w-2xl bg-surface border border-border-brass rounded-sm shadow-velvet-raised overflow-hidden">
            {/* Modal Header */}
            <div className="flex justify-between items-center p-4 border-b border-border-brass bg-surface-2">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-accent">REPERTORY VAULT SPECIFICATION</span>
                <span className="text-muted">•</span>
                <span className="font-mono text-xs text-muted">ID: {previewMovie.id}</span>
              </div>
              <button
                onClick={() => setPreviewMovie(null)}
                className="text-muted hover:text-text cursor-pointer font-mono text-sm px-2 py-0.5"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="relative aspect-[2/3] w-full rounded-sm overflow-hidden border border-border-brass">
                <img
                  src={previewMovie.posterUrl}
                  alt={previewMovie.title}
                  className="w-full h-full object-cover"
                />
              </div>

              <div className="md:col-span-2 space-y-4">
                <div>
                  <h2 className="font-display font-bold text-2xl text-text">
                    {previewMovie.title}
                  </h2>
                  <div className="flex items-center gap-3 mt-1 text-xs font-mono text-muted">
                    <span>{previewMovie.year}</span>
                    <span>•</span>
                    <span>{previewMovie.runtime} min</span>
                    <span>•</span>
                    <span className="text-accent font-bold">★ {previewMovie.rating.toFixed(1)} / 10</span>
                  </div>
                </div>

                <div className="text-xs font-mono text-muted space-y-1">
                  <div>
                    <span className="text-text font-semibold">Director: </span>
                    <span>{previewMovie.director}</span>
                  </div>
                  <div>
                    <span className="text-text font-semibold">Cast: </span>
                    <span>{previewMovie.cast.join(', ')}</span>
                  </div>
                  <div>
                    <span className="text-text font-semibold">Genres: </span>
                    <span>{previewMovie.genres.join(', ')}</span>
                  </div>
                </div>

                <p className="text-sm font-sans text-muted leading-relaxed">
                  {previewMovie.description}
                </p>

                {/* Actions */}
                <div className="pt-4 border-t border-border-brass flex items-center gap-3">
                  <button
                    onClick={() => {
                      onSelectMovieForSuite?.(previewMovie);
                      setPreviewMovie(null);
                    }}
                    className="flex-1 py-2.5 px-4 bg-accent hover:bg-accent/90 active:scale-95 text-[#0E0B09] font-mono font-bold text-xs rounded-sm shadow-projector transition-all flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/></svg>
                    <span>Select for New Suite</span>
                  </button>
                  <button
                    onClick={() => setPreviewMovie(null)}
                    className="py-2.5 px-4 bg-surface-2 hover:bg-surface-3 active:scale-95 text-text border border-border-brass font-mono text-xs rounded-sm transition-all cursor-pointer"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
