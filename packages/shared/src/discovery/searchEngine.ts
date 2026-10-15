import Fuse, { IFuseOptions } from "fuse.js";
import {
  Movie,
  MovieFilter,
  MovieSort,
  MovieSearchResult,
  MatchHighlight,
} from "./types.js";

const DEFAULT_FUSE_OPTIONS: IFuseOptions<Movie> = {
  keys: [
    { name: "title", weight: 0.6 },
    { name: "cast", weight: 0.25 },
    { name: "description", weight: 0.15 },
  ],
  threshold: 0.4, // Typo tolerance: 0.0 is exact match, 1.0 matches everything
  distance: 100,
  includeScore: true,
  includeMatches: true,
  minMatchCharLength: 2,
  ignoreLocation: true,
};

export class MovieSearchEngine {
  private catalogue: Movie[];
  private fuse: Fuse<Movie>;

  constructor(catalogue: Movie[], options?: Partial<IFuseOptions<Movie>>) {
    this.catalogue = [...catalogue];
    this.fuse = new Fuse(this.catalogue, {
      ...DEFAULT_FUSE_OPTIONS,
      ...options,
    });
  }

  public setCatalogue(catalogue: Movie[]): void {
    this.catalogue = [...catalogue];
    this.fuse.setCollection(this.catalogue);
  }

  public search(
    query: string,
    filter?: MovieFilter,
    sort: MovieSort = "relevance"
  ): MovieSearchResult[] {
    const trimmedQuery = query.trim();

    let rawResults: MovieSearchResult[];

    if (trimmedQuery.length > 0) {
      const fuseResults = this.fuse.search(trimmedQuery);
      rawResults = fuseResults.map((res) => {
        const matches: MatchHighlight[] = (res.matches || []).map((m) => ({
          key: m.key || "",
          value: m.value || "",
          indices: m.indices as readonly [number, number][],
        }));

        const titleMatch = matches.find((m) => m.key === "title");
        const highlightedTitle = titleMatch
          ? highlightMatch(res.item.title, titleMatch.indices)
          : res.item.title;

        return {
          movie: res.item,
          score: res.score,
          matches,
          highlightedTitle,
        };
      });
    } else {
      // Empty query: all catalogue items
      rawResults = this.catalogue.map((movie) => ({
        movie,
        highlightedTitle: movie.title,
      }));
    }

    // Apply Filters
    let filtered = rawResults.filter((result) =>
      this.matchesFilter(result.movie, filter)
    );

    // Apply Sorting
    filtered = this.sortResults(filtered, sort, trimmedQuery.length > 0);

    return filtered;
  }

  private matchesFilter(movie: Movie, filter?: MovieFilter): boolean {
    if (!filter) return true;

    // 1. Category Filter
    if (filter.category) {
      switch (filter.category) {
        case "trending":
          if (movie.trendingScore < 85) return false;
          break;
        case "top_rated":
          if (movie.rating < 8.4) return false;
          break;
        case "free_to_watch":
          if (!movie.isFree) return false;
          break;
        case "action_scifi":
          if (!movie.genres.some((g) => g === "Action" || g === "Sci-Fi")) return false;
          break;
        case "comedy_drama":
          if (!movie.genres.some((g) => g === "Comedy" || g === "Drama")) return false;
          break;
        case "animation_family":
          if (!movie.genres.some((g) => g === "Animation" || g === "Family")) return false;
          break;
        case "short_films":
          if (movie.runtime > 30) return false;
          break;
        case "classic":
          if (movie.year >= 2000) return false;
          break;
        case "international":
          if (movie.language === "en") return false;
          break;
      }
    }

    // 2. Genres Multi-select (movie must have at least one of the selected genres)
    if (filter.genres && filter.genres.length > 0) {
      const hasGenre = filter.genres.some((selectedGenre) =>
        movie.genres.map((g) => g.toLowerCase()).includes(selectedGenre.toLowerCase())
      );
      if (!hasGenre) return false;
    }

    // 3. Year Range
    if (filter.yearRange) {
      const [minYear, maxYear] = filter.yearRange;
      if (movie.year < minYear || movie.year > maxYear) return false;
    }

    // 4. Minimum Rating
    if (typeof filter.minRating === "number") {
      if (movie.rating < filter.minRating) return false;
    }

    // 5. Maximum Runtime
    if (typeof filter.maxRuntime === "number") {
      if (movie.runtime > filter.maxRuntime) return false;
    }

    // 6. Language
    if (filter.language && filter.language.length > 0) {
      if (movie.language.toLowerCase() !== filter.language.toLowerCase()) return false;
    }

    // 7. Free to watch filter
    if (filter.isFree && !movie.isFree) {
      return false;
    }

    return true;
  }

  private sortResults(
    results: MovieSearchResult[],
    sort: MovieSort,
    hasQuery: boolean
  ): MovieSearchResult[] {
    const list = [...results];

    switch (sort) {
      case "relevance":
        if (hasQuery) {
          // Ascending Fuse.js score (0 = best match)
          return list.sort((a, b) => (a.score ?? 1) - (b.score ?? 1));
        }
        // Fallback when query is empty: sort by trendingScore desc
        return list.sort((a, b) => b.movie.trendingScore - a.movie.trendingScore);

      case "rating_desc":
        return list.sort((a, b) => b.movie.rating - a.movie.rating);

      case "year_desc":
        return list.sort((a, b) => b.movie.year - a.movie.year);

      case "year_asc":
        return list.sort((a, b) => a.movie.year - b.movie.year);

      case "runtime_asc":
        return list.sort((a, b) => a.movie.runtime - b.movie.runtime);

      case "runtime_desc":
        return list.sort((a, b) => b.movie.runtime - a.movie.runtime);

      case "title_asc":
        return list.sort((a, b) => a.movie.title.localeCompare(b.movie.title));

      default:
        return list;
    }
  }
}

/**
 * Injects `<mark>` tags around matched character ranges from fuzzy search.
 */
export function highlightMatch(
  text: string,
  indices: readonly [number, number][],
  tag = "mark"
): string {
  if (!indices || indices.length === 0) return text;

  // Sort and merge overlapping indices
  const sorted = [...indices].sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];

  for (const [start, end] of sorted) {
    if (merged.length === 0) {
      merged.push([start, end]);
    } else {
      const prev = merged[merged.length - 1];
      if (start <= prev[1] + 1) {
        prev[1] = Math.max(prev[1], end);
      } else {
        merged.push([start, end]);
      }
    }
  }

  let result = "";
  let lastIndex = 0;

  for (const [start, end] of merged) {
    result += text.slice(lastIndex, start);
    result += `<${tag}>${text.slice(start, end + 1)}</${tag}>`;
    lastIndex = end + 1;
  }
  result += text.slice(lastIndex);

  return result;
}

/**
 * Generic debounce utility with cancel support.
 */
export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  waitMs = 250
): {
  (...args: Parameters<T>): void;
  cancel: () => void;
} {
  let timeout: any = null;

  const debounced = (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => {
      fn(...args);
    }, waitMs);
  };

  debounced.cancel = () => {
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
  };

  return debounced;
}
