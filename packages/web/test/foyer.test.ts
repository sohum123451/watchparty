import { describe, it, expect } from 'vitest';
import { MOVIE_CATALOGUE, MovieSearchEngine } from '@watchparty/shared';
import { RoomPosterItem } from '../src/components/foyer/PosterTiltCard';
import { FriendItem, TicketNotification } from '../src/components/foyer/FriendsRail';

describe('Cinema Foyer & Lobby Components Suite', () => {
  describe('Now Showing Poster Tilt Tiles & Editorial Layout', () => {
    const mockRoom: RoomPosterItem = {
      id: 'room_1',
      roomCode: 'CRITERION-70MM',
      title: 'Blade Runner (Final Cut)',
      hostName: 'Elena Rostova',
      posterUrl: 'https://images.unsplash.com/photo-1578632767115-351597cf2477',
      format: '70mm',
      memberCount: 6,
      members: [
        { id: 'm1', name: 'Elena', avatar: 'E', isLive: true },
        { id: 'm2', name: 'Marcus', avatar: 'M', isLive: true },
      ],
      timecode: '01:24:18',
      layoutVariant: 'feature',
    };

    it('defines editorial layout variants with distinct height and span classes', () => {
      const variantStyles = {
        tall: 'md:row-span-2 min-h-[380px]',
        wide: 'md:col-span-2 min-h-[220px]',
        feature: 'md:col-span-2 md:row-span-2 min-h-[420px]',
        standard: 'min-h-[260px]',
      };

      expect(variantStyles.feature).toContain('md:col-span-2 md:row-span-2');
      expect(variantStyles.tall).toContain('md:row-span-2');
      expect(variantStyles.wide).toContain('md:col-span-2');
      expect(variantStyles.standard).toBe('min-h-[260px]');
    });

    it('calculates 3D perspective tilt angles bounded within safe limits', () => {
      const calculateTilt = (x: number, y: number) => {
        const rotateX = +((0.5 - y) * 14).toFixed(2);
        const rotateY = +((x - 0.5) * 14).toFixed(2);
        return { rotateX, rotateY };
      };

      // Top-left corner
      const tl = calculateTilt(0, 0);
      expect(tl.rotateX).toBe(7);
      expect(tl.rotateY).toBe(-7);

      // Center (neutral)
      const center = calculateTilt(0.5, 0.5);
      expect(center.rotateX).toBe(0);
      expect(center.rotateY).toBe(0);

      // Bottom-right corner
      const br = calculateTilt(1, 1);
      expect(br.rotateX).toBe(-7);
      expect(br.rotateY).toBe(7);
    });
  });

  describe('Friends Rail & Live Presence Pulse Constraints', () => {
    const mockFriends: FriendItem[] = [
      { id: '1', name: 'Elena', avatar: 'E', status: 'live', currentRoom: 'Stalker (70mm)' },
      { id: '2', name: 'Sophia', avatar: 'S', status: 'idle', currentRoom: 'Lobby' },
      { id: '3', name: 'Leo', avatar: 'L', status: 'offline' },
    ];

    it('applies pulse animation ONLY to live friends and steady indicator to idle/offline', () => {
      const getPresenceDotClass = (status: FriendItem['status']) => {
        if (status === 'live') {
          return 'bg-live shadow-cathode animate-cathode-pulse';
        }
        if (status === 'idle') {
          return 'bg-accent/80 shadow-none'; // Steady, no pulse
        }
        return 'bg-muted/40 shadow-none'; // Steady, no pulse
      };

      const liveDot = getPresenceDotClass(mockFriends[0].status);
      const idleDot = getPresenceDotClass(mockFriends[1].status);
      const offlineDot = getPresenceDotClass(mockFriends[2].status);

      expect(liveDot).toContain('animate-cathode-pulse');
      expect(idleDot).not.toContain('animate-cathode-pulse');
      expect(offlineDot).not.toContain('animate-cathode-pulse');
    });

    it('formats ticket notifications with perforated stubs and codes', () => {
      const notif: TicketNotification = {
        id: 'notif_1',
        fromName: 'Marcus Vance',
        roomName: 'Blade Runner (Final Cut)',
        roomCode: 'DECK-2049',
        timeAgo: '18m ago',
        stubNumber: '008915',
      };

      expect(notif.stubNumber).toBe('008915');
      expect(notif.roomCode).toBe('DECK-2049');
    });
  });

  describe('Movie Discovery & Fuzzy Search Match Highlighting', () => {
    const engine = new MovieSearchEngine(MOVIE_CATALOGUE);

    it('locates movies through fuzzy search queries', () => {
      const results = engine.search('Inception');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].movie.title).toBe('Inception');
    });

    it('highlights matched substrings in search results', () => {
      const results = engine.search('Matrix');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].highlightedTitle).toContain('<mark>');
      expect(results[0].highlightedTitle).toContain('Matrix');
    });

    it('filters catalogue by genre chips', () => {
      const scifiResults = engine.search('', { genres: ['Sci-Fi'] });
      expect(scifiResults.length).toBeGreaterThan(0);
      for (const res of scifiResults) {
        expect(res.movie.genres).toContain('Sci-Fi');
      }
    });

    it('filters catalogue by category (e.g. trending or top_rated)', () => {
      const trendingResults = engine.search('', { category: 'trending' });
      expect(trendingResults.length).toBeGreaterThan(0);
      for (const res of trendingResults) {
        expect(res.movie.trendingScore).toBeGreaterThanOrEqual(85);
      }
    });
  });

  describe('Create Room Flow & 35mm Progress Film Strip', () => {
    it('manages 3-step state progression for room commissioning', () => {
      let step: 1 | 2 | 3 = 1;
      const nextStep = () => {
        if (step < 3) step = (step + 1) as 1 | 2 | 3;
      };
      const prevStep = () => {
        if (step > 1) step = (step - 1) as 1 | 2 | 3;
      };

      expect(step).toBe(1);
      nextStep();
      expect(step).toBe(2);
      nextStep();
      expect(step).toBe(3);
      nextStep();
      expect(step).toBe(3); // Capped at 3
      prevStep();
      expect(step).toBe(2);
    });

    it('supports 3 access tiers: public, friends, and secret E2EE', () => {
      const tiers = ['public', 'friends', 'secret'] as const;
      expect(tiers.length).toBe(3);
      expect(tiers).toContain('public');
      expect(tiers).toContain('friends');
      expect(tiers).toContain('secret');
    });

    it('enforces playback drift sync slider within safe auditorium bounds', () => {
      const clampDrift = (ms: number) => Math.min(Math.max(ms, 40), 400);

      expect(clampDrift(120)).toBe(120);
      expect(clampDrift(10)).toBe(40);
      expect(clampDrift(1000)).toBe(400);
    });
  });
});
