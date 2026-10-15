import { describe, it, expect, vi } from "vitest";
import {
  MOVIE_CATALOGUE,
  MovieSearchEngine,
  highlightMatch,
  debounce,
  computeRoomRecommendations,
  LocalMovieProvider,
  TmdbMovieProvider,
  createPlaylistItemFromMovie,
  PlaylistItem,
  Poll,
  ReactionBurst,
} from "../src/index.js";

describe("Movie Discovery Module", () => {
  const engine = new MovieSearchEngine(MOVIE_CATALOGUE);

  describe("1. Fuzzy Search & Search Ranking", () => {
    it("exact title search ranks the intended movie first with high confidence", () => {
      const results = engine.search("Inception");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].movie.title).toBe("Inception");
      expect(results[0].score).toBeLessThan(0.1); // Near 0 = perfect match
    });

    it("searches across cast members accurately", () => {
      const results = engine.search("Leonardo DiCaprio");
      expect(results.length).toBeGreaterThanOrEqual(2);
      const titles = results.map((r) => r.movie.title);
      expect(titles).toContain("Inception");
      expect(titles).toContain("The Departed");
    });

    it("prioritizes title matches over cast or description matches", () => {
      // "Batman" is in The Dark Knight's description, but let's test a query matching title vs synopsis
      const results = engine.search("Matrix");
      expect(results[0].movie.title).toBe("The Matrix");
    });
  });

  describe("2. Typo Tolerance", () => {
    it("matches 'incepton' -> Inception", () => {
      const results = engine.search("incepton");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].movie.title).toBe("Inception");
    });

    it("matches 'interstelar' -> Interstellar", () => {
      const results = engine.search("interstelar");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].movie.title).toBe("Interstellar");
    });

    it("matches 'pulp ficiton' -> Pulp Fiction", () => {
      const results = engine.search("pulp ficiton");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].movie.title).toBe("Pulp Fiction");
    });

    it("matches 'dark nite' -> The Dark Knight", () => {
      const results = engine.search("dark nite");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].movie.title).toBe("The Dark Knight");
    });

    it("matches 'shawshank' -> The Shawshank Redemption", () => {
      const results = engine.search("shawshank");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].movie.title).toBe("The Shawshank Redemption");
    });

    it("matches 'matrx' -> The Matrix", () => {
      const results = engine.search("matrx");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].movie.title).toBe("The Matrix");
    });
  });

  describe("3. Categories & Multi-Filter Combos", () => {
    it("filters by category: short_films (< 30 minutes)", () => {
      const results = engine.search("", { category: "short_films" });
      expect(results.length).toBeGreaterThanOrEqual(3);
      for (const res of results) {
        expect(res.movie.runtime).toBeLessThanOrEqual(30);
      }
      const titles = results.map((r) => r.movie.title);
      expect(titles).toContain("Big Buck Bunny");
      expect(titles).toContain("Tears of Steel");
      expect(titles).toContain("Sintel");
    });

    it("filters by category: international (non-English)", () => {
      const results = engine.search("", { category: "international" });
      expect(results.length).toBeGreaterThanOrEqual(3);
      for (const res of results) {
        expect(res.movie.language).not.toBe("en");
      }
      const titles = results.map((r) => r.movie.title);
      expect(titles).toContain("Parasite");
      expect(titles).toContain("Spirited Away");
      expect(titles).toContain("Pan's Labyrinth");
    });

    it("filters by multi-genre selection (Animation)", () => {
      const results = engine.search("", { genres: ["Animation"] });
      expect(results.length).toBeGreaterThanOrEqual(5);
      for (const res of results) {
        expect(res.movie.genres).toContain("Animation");
      }
    });

    it("combines multiple filters: Sci-Fi + rating >= 8.5 + year >= 2000", () => {
      const results = engine.search("", {
        genres: ["Sci-Fi"],
        minRating: 8.5,
        yearRange: [2000, 2024],
      });

      expect(results.length).toBeGreaterThan(0);
      for (const res of results) {
        expect(res.movie.genres).toContain("Sci-Fi");
        expect(res.movie.rating).toBeGreaterThanOrEqual(8.5);
        expect(res.movie.year).toBeGreaterThanOrEqual(2000);
      }
      const titles = results.map((r) => r.movie.title);
      expect(titles).toContain("Inception");
      expect(titles).toContain("Interstellar");
    });
  });

  describe("4. Sorting", () => {
    it("sorts by rating_desc", () => {
      const results = engine.search("", {}, "rating_desc");
      for (let i = 0; i < results.length - 1; i++) {
        expect(results[i].movie.rating).toBeGreaterThanOrEqual(results[i + 1].movie.rating);
      }
    });

    it("sorts by year_desc", () => {
      const results = engine.search("", {}, "year_desc");
      for (let i = 0; i < results.length - 1; i++) {
        expect(results[i].movie.year).toBeGreaterThanOrEqual(results[i + 1].movie.year);
      }
    });

    it("sorts by runtime_asc", () => {
      const results = engine.search("", {}, "runtime_asc");
      for (let i = 0; i < results.length - 1; i++) {
        expect(results[i].movie.runtime).toBeLessThanOrEqual(results[i + 1].movie.runtime);
      }
    });
  });

  describe("5. Highlighting & Debounce Utilities", () => {
    it("highlightMatch wraps character indices in <mark> tags", () => {
      const highlighted = highlightMatch("Inception", [[0, 2]]);
      expect(highlighted).toBe("<mark>Inc</mark>eption");

      const multiple = highlightMatch("The Matrix", [
        [0, 2],
        [4, 9],
      ]);
      expect(multiple).toBe("<mark>The</mark> <mark>Matrix</mark>");
    });

    it("debounce delays invocation until delay period elapses", () => {
      vi.useFakeTimers();
      const fn = vi.fn();
      const debounced = debounce(fn, 300);

      debounced("call 1");
      debounced("call 2");
      debounced("call 3");

      expect(fn).not.toHaveBeenCalled();

      vi.advanceTimersByTime(299);
      expect(fn).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith("call 3");

      vi.useRealTimers();
    });
  });

  describe("6. Room Recommendations (Content-based)", () => {
    it("generates recommendations based on playlist taste (Sci-Fi / Adventure)", () => {
      const playlist: PlaylistItem[] = [
        {
          id: "pl_1",
          videoId: "mov_001", // Inception (Sci-Fi, Action, Thriller)
          title: "Inception",
          durationMs: 148 * 60 * 1000,
          addedByUserId: "u1",
          addedByUserName: "Alice",
        },
        {
          id: "pl_2",
          videoId: "mov_002", // Interstellar (Sci-Fi, Adventure, Drama)
          title: "Interstellar",
          durationMs: 169 * 60 * 1000,
          addedByUserId: "u2",
          addedByUserName: "Bob",
        },
      ];

      const recs = computeRoomRecommendations({
        catalogue: MOVIE_CATALOGUE,
        playlist,
      });

      expect(recs.length).toBeGreaterThan(0);
      // Candidates already in the playlist must NOT be re-recommended
      const recIds = recs.map((r) => r.movie.id);
      expect(recIds).not.toContain("mov_001");
      expect(recIds).not.toContain("mov_002");

      // Top recommendations should strongly share Sci-Fi, Action, or Adventure genres
      const topRec = recs[0];
      const sharedGenres = topRec.movie.genres.filter(
        (g) => g === "Sci-Fi" || g === "Action" || g === "Drama"
      );
      expect(sharedGenres.length).toBeGreaterThan(0);
      expect(topRec.reason).toContain("affinity");
    });

    it("incorporates group poll votes to steer recommendations", () => {
      const activePoll: Poll = {
        id: "poll_1",
        question: "What genre should we watch next?",
        options: [
          { id: "o1", text: "Animation", votes: 8, voterUserIds: ["u1", "u2", "u3"] },
          { id: "o2", text: "Horror", votes: 1, voterUserIds: ["u4"] },
        ],
        createdByUserId: "u1",
        createdAt: Date.now(),
        durationMs: 30000,
        expiresAtServerTimeMs: Date.now() + 30000,
        isClosed: false,
      };

      const recs = computeRoomRecommendations({
        catalogue: MOVIE_CATALOGUE,
        playlist: [],
        activePoll,
      });

      expect(recs.length).toBeGreaterThan(0);
      // Animation had 8 votes -> top recommendations should be animated films
      const topThreeGenres = recs.slice(0, 3).flatMap((r) => r.movie.genres);
      expect(topThreeGenres).toContain("Animation");
    });

    it("incorporates positive emoji reactions to amplify currently playing movie genres", () => {
      const reactions: ReactionBurst[] = [
        { id: "r1", userId: "u1", userName: "A", emoji: "❤️", videoTimestampMs: 1000 },
        { id: "r2", userId: "u2", userName: "B", emoji: "🔥", videoTimestampMs: 2000 },
        { id: "r3", userId: "u3", userName: "C", emoji: "🚀", videoTimestampMs: 3000 },
      ];

      const recs = computeRoomRecommendations({
        catalogue: MOVIE_CATALOGUE,
        playlist: [],
        reactions,
        currentPlayingVideoId: "mov_004", // The Matrix (Sci-Fi, Action)
      });

      expect(recs.length).toBeGreaterThan(0);
      const topGenres = recs[0].movie.genres;
      const matchesSciFiOrAction = topGenres.includes("Sci-Fi") || topGenres.includes("Action");
      expect(matchesSciFiOrAction).toBe(true);
    });
  });

  describe("7. Shared Playlist Addition & TMDB Provider", () => {
    it("creates valid PlaylistItem entity from Movie", () => {
      const movie = MOVIE_CATALOGUE[0];
      const item = createPlaylistItemFromMovie(movie, {
        userId: "usr_alice",
        userName: "Alice",
      });

      expect(item.videoId).toBe(movie.id);
      expect(item.title).toBe(movie.title);
      expect(item.durationMs).toBe(movie.runtime * 60 * 1000);
      expect(item.thumbnailUrl).toBe(movie.posterUrl);
      expect(item.addedByUserId).toBe("usr_alice");
      expect(item.addedByUserName).toBe("Alice");
    });

    it("LocalMovieProvider retrieves and searches accurately", async () => {
      const provider = new LocalMovieProvider(MOVIE_CATALOGUE);
      const movies = await provider.getMovies();
      expect(movies.length).toBe(MOVIE_CATALOGUE.length);

      const found = await provider.getMovieById("mov_001");
      expect(found?.title).toBe("Inception");

      const searchRes = await provider.searchMovies("interstellar");
      expect(searchRes[0].movie.title).toBe("Interstellar");
    });

    it("TmdbMovieProvider falls back gracefully to local catalogue when no API key provided", async () => {
      const tmdb = new TmdbMovieProvider(undefined, MOVIE_CATALOGUE);
      expect(tmdb.hasApiKey()).toBe(false);

      const movies = await tmdb.getMovies();
      expect(movies.length).toBe(MOVIE_CATALOGUE.length);

      const movie = await tmdb.getMovieById("mov_003");
      expect(movie?.title).toBe("The Dark Knight");

      const searchRes = await tmdb.searchMovies("Inception");
      expect(searchRes[0].movie.title).toBe("Inception");
    });
  });
});
