export interface Movie {
  id: string;
  title: string;
  year: number;
  genres: string[];
  rating: number; // e.g. 8.8 (out of 10)
  runtime: number; // Duration in minutes
  language: string; // ISO 639-1 code (e.g. "en", "es", "ja", "ko", "fr")
  cast: string[];
  director: string;
  description: string;
  posterUrl: string;
  videoUrl: string; // Playable HTML5 MP4/HLS sample stream
  trendingScore: number; // Popularity ranking metric (0-100)
  isFree?: boolean; // Legally free to watch
  license?: string; // License name (e.g. "Creative Commons Attribution 3.0", "Public Domain")
  attribution?: string; // Copyright attribution / archive credit
  provider?: string; // "html5" | "youtube"
}

export type MovieCategory =
  | "trending"
  | "top_rated"
  | "free_to_watch"
  | "action_scifi"
  | "comedy_drama"
  | "animation_family"
  | "short_films"
  | "classic"
  | "international";

export type MovieSort =
  | "relevance"
  | "rating_desc"
  | "year_desc"
  | "year_asc"
  | "runtime_asc"
  | "runtime_desc"
  | "title_asc";

export interface MovieFilter {
  genres?: string[];
  yearRange?: [number, number]; // [minYear, maxYear]
  minRating?: number;
  maxRuntime?: number; // max minutes
  language?: string;
  category?: MovieCategory;
  isFree?: boolean; // "Free to watch" filter toggle
}

export interface MatchHighlight {
  key: string;
  value: string;
  indices: readonly [number, number][];
}

export interface MovieSearchResult {
  movie: Movie;
  score?: number; // Fuse.js score (0 = perfect match, 1 = mismatch)
  matches?: MatchHighlight[];
  highlightedTitle?: string;
}

export interface MovieRecommendation {
  movie: Movie;
  score: number; // Recommendation confidence (0-1)
  reason: string;
  matchedGenres: string[];
}

export interface MovieProvider {
  getMovies(): Promise<Movie[]>;
  getMovieById(id: string): Promise<Movie | null>;
  searchMovies(
    query: string,
    filter?: MovieFilter,
    sort?: MovieSort
  ): Promise<MovieSearchResult[]>;
}
