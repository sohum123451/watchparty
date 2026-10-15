import {
  Movie,
  MovieRecommendation,
} from "./types.js";
import { PlaylistItem, Poll, ReactionBurst } from "../models.js";

export interface RoomContext {
  catalogue: Movie[];
  playlist: PlaylistItem[];
  activePoll?: Poll | null;
  reactions?: ReactionBurst[];
  currentPlayingVideoId?: string;
}

const POSITIVE_EMOJIS = new Set(["❤️", "🔥", "👍", "🎬", "🚀", "😍", "👏", "🍿", "🎉"]);

/**
 * Computes content-based movie recommendations tailored to the room's collective taste.
 * Combines signals from queued playlist items, group poll voting, and live emoji reactions.
 */
export function computeRoomRecommendations(
  context: RoomContext,
  limit = 8
): MovieRecommendation[] {
  const { catalogue, playlist, activePoll, reactions, currentPlayingVideoId } = context;

  const movieMap = new Map<string, Movie>(catalogue.map((m) => [m.id, m]));
  const queuedMovieIds = new Set<string>(playlist.map((p) => p.videoId));
  if (currentPlayingVideoId) {
    queuedMovieIds.add(currentPlayingVideoId);
  }

  // 1. Build Room Taste Vector
  const genreWeights: Record<string, number> = {};
  let totalSignalWeight = 0;

  const addGenreWeight = (genre: string, weight: number) => {
    const normalized = genre.trim();
    genreWeights[normalized] = (genreWeights[normalized] || 0) + weight;
    totalSignalWeight += weight;
  };

  // Signal A: Playlist Selections (Weight: 3.0 per movie)
  for (const item of playlist) {
    const movie = movieMap.get(item.videoId);
    if (movie) {
      for (const genre of movie.genres) {
        addGenreWeight(genre, 3.0);
      }
    }
  }

  // Signal B: Group Poll Votes (Weight: 2.0 * votes)
  if (activePoll && activePoll.options) {
    for (const option of activePoll.options) {
      if (option.votes > 0) {
        // Check if option text matches any genre directly
        const matchedGenre = catalogue
          .flatMap((m) => m.genres)
          .find((g) => g.toLowerCase() === option.text.toLowerCase());

        if (matchedGenre) {
          addGenreWeight(matchedGenre, option.votes * 2.5);
        } else {
          // Check if option matches a movie title in catalogue
          const matchedMovie = catalogue.find(
            (m) => m.title.toLowerCase() === option.text.toLowerCase()
          );
          if (matchedMovie) {
            for (const genre of matchedMovie.genres) {
              addGenreWeight(genre, option.votes * 2.0);
            }
          }
        }
      }
    }
  }

  // Signal C: Live Positive Emoji Reactions (Weight: 1.0 * count)
  if (reactions && reactions.length > 0 && currentPlayingVideoId) {
    const currentMovie = movieMap.get(currentPlayingVideoId);
    if (currentMovie) {
      const positiveReactionCount = reactions.filter((r) =>
        POSITIVE_EMOJIS.has(r.emoji)
      ).length;
      if (positiveReactionCount > 0) {
        for (const genre of currentMovie.genres) {
          addGenreWeight(genre, Math.min(10, positiveReactionCount * 1.0));
        }
      }
    }
  }

  // 2. Score Candidates
  const candidates = catalogue.filter((m) => !queuedMovieIds.has(m.id));
  const hasTasteProfile = totalSignalWeight > 0;

  const scoredRecommendations: MovieRecommendation[] = candidates.map((movie) => {
    let genreOverlapScore = 0;
    const matchedGenres: string[] = [];

    if (hasTasteProfile) {
      for (const g of movie.genres) {
        if (genreWeights[g]) {
          genreOverlapScore += genreWeights[g];
          matchedGenres.push(g);
        }
      }
    }

    const ratingScore = movie.rating / 10; // Normalized 0-1
    const trendingBoost = movie.trendingScore / 100;

    let finalScore: number;
    let reason: string;

    if (hasTasteProfile && matchedGenres.length > 0) {
      const normalizedAffinity = Math.min(1, genreOverlapScore / (totalSignalWeight * 0.6));
      finalScore = 0.65 * normalizedAffinity + 0.35 * ratingScore;

      const topGenresStr = matchedGenres.slice(0, 2).join(" & ");
      reason = `Matches the room's high affinity for ${topGenresStr} (${movie.rating}★ rating)`;
    } else {
      // Fallback for new rooms or unaligned movies: rank by rating & trending
      finalScore = 0.5 * ratingScore + 0.5 * trendingBoost;
      reason = `Highly rated watch party favorite with ${movie.rating}★ rating`;
    }

    return {
      movie,
      score: Number(finalScore.toFixed(3)),
      reason,
      matchedGenres,
    };
  });

  // Sort descending by score and return top results
  return scoredRecommendations
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
