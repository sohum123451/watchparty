import {
  Movie,
  MovieProvider,
  MovieFilter,
  MovieSort,
  MovieSearchResult,
} from "./types.js";
import { MOVIE_CATALOGUE } from "./catalogue.js";
import { MovieSearchEngine } from "./searchEngine.js";
import { PlaylistItem } from "../models.js";

/**
 * Local movie provider backed by the in-memory catalogue.
 */
export class LocalMovieProvider implements MovieProvider {
  private catalogue: Movie[];
  private searchEngine: MovieSearchEngine;

  constructor(catalogue: Movie[] = MOVIE_CATALOGUE) {
    this.catalogue = catalogue;
    this.searchEngine = new MovieSearchEngine(catalogue);
  }

  public async getMovies(): Promise<Movie[]> {
    return [...this.catalogue];
  }

  public async getMovieById(id: string): Promise<Movie | null> {
    const movie = this.catalogue.find((m) => m.id === id);
    return movie || null;
  }

  public async searchMovies(
    query: string,
    filter?: MovieFilter,
    sort?: MovieSort
  ): Promise<MovieSearchResult[]> {
    return this.searchEngine.search(query, filter, sort);
  }
}

/**
 * TMDB Adapter implementing MovieProvider.
 * Fetches from The Movie Database API v3 when an API key is provided;
 * automatically falls back to LocalMovieProvider if no key is provided or on network error.
 */
export class TmdbMovieProvider implements MovieProvider {
  private readonly apiKey?: string;
  private readonly fallbackProvider: LocalMovieProvider;
  private readonly baseUrl = "https://api.themoviedb.org/3";
  private readonly imageBaseUrl = "https://image.tmdb.org/t/p/w500";

  constructor(apiKey?: string, localCatalogue: Movie[] = MOVIE_CATALOGUE) {
    this.apiKey = apiKey;
    this.fallbackProvider = new LocalMovieProvider(localCatalogue);
  }

  public hasApiKey(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  public async getMovies(): Promise<Movie[]> {
    if (!this.hasApiKey()) {
      return this.fallbackProvider.getMovies();
    }

    try {
      const res = await fetch(`${this.baseUrl}/trending/movie/week?api_key=${this.apiKey}`);
      if (!res.ok) throw new Error(`TMDB error: ${res.statusText}`);
      const data = await res.json();
      return (data.results || []).map((item: any) => this.mapTmdbToMovie(item));
    } catch {
      return this.fallbackProvider.getMovies();
    }
  }

  public async getMovieById(id: string): Promise<Movie | null> {
    if (!this.hasApiKey()) {
      return this.fallbackProvider.getMovieById(id);
    }

    try {
      const res = await fetch(`${this.baseUrl}/movie/${id}?api_key=${this.apiKey}&append_to_response=credits`);
      if (!res.ok) throw new Error(`TMDB error: ${res.statusText}`);
      const data = await res.json();
      return this.mapTmdbToMovie(data);
    } catch {
      return this.fallbackProvider.getMovieById(id);
    }
  }

  public async searchMovies(
    query: string,
    filter?: MovieFilter,
    sort?: MovieSort
  ): Promise<MovieSearchResult[]> {
    if (!this.hasApiKey() || !query.trim()) {
      return this.fallbackProvider.searchMovies(query, filter, sort);
    }

    try {
      const url = `${this.baseUrl}/search/movie?api_key=${this.apiKey}&query=${encodeURIComponent(query)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`TMDB error: ${res.statusText}`);
      const data = await res.json();

      const movies: Movie[] = (data.results || []).map((item: any) => this.mapTmdbToMovie(item));
      const tempEngine = new MovieSearchEngine(movies);
      return tempEngine.search(query, filter, sort);
    } catch {
      return this.fallbackProvider.searchMovies(query, filter, sort);
    }
  }

  private mapTmdbToMovie(item: any): Movie {
    const year = item.release_date ? new Date(item.release_date).getFullYear() : 2024;
    const cast = (item.credits?.cast || []).slice(0, 4).map((c: any) => c.name);
    const director =
      (item.credits?.crew || []).find((c: any) => c.job === "Director")?.name || "Unknown Director";

    return {
      id: `tmdb_${item.id}`,
      title: item.title || item.original_title || "Untitled",
      year: isNaN(year) ? 2024 : year,
      genres: (item.genres || []).map((g: any) => g.name || "Cinema"),
      rating: Number((item.vote_average || 7.0).toFixed(1)),
      runtime: item.runtime || 120,
      language: item.original_language || "en",
      cast: cast.length > 0 ? cast : ["Lead Actor"],
      director,
      description: item.overview || "No synopsis available.",
      posterUrl: item.poster_path ? `${this.imageBaseUrl}${item.poster_path}` : MOVIE_CATALOGUE[0].posterUrl,
      videoUrl: MOVIE_CATALOGUE[0].videoUrl, // Open sample video stream fallback
      trendingScore: Math.min(100, Math.round((item.popularity || 50) / 10)),
    };
  }
}

/**
 * Creates a valid shared PlaylistItem from a Movie entity so anyone can queue it to the room.
 */
export function createPlaylistItemFromMovie(
  movie: Movie,
  addedBy: { userId: string; userName: string }
): PlaylistItem {
  return {
    id: `pl_${Math.random().toString(36).slice(2, 10)}`,
    videoId: movie.id,
    provider: "html5",
    sourceRef: movie.id,
    title: movie.title,
    durationMs: movie.runtime * 60 * 1000,
    thumbnailUrl: movie.posterUrl,
    addedByUserId: addedBy.userId,
    addedByUserName: addedBy.userName,
  };
}
