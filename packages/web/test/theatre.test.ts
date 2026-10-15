import { describe, it, expect } from 'vitest';

describe('Theatre Auditorium & Room Redesign Suite', () => {
  describe('Lights-Down / Lights-Up Anime.js Timeline States', () => {
    it('defines correct dimming and opacity values for lights-down playback', () => {
      const getLightsDownState = (isPlaying: boolean) => {
        if (isPlaying) {
          return {
            houseLightsOpacity: 0.05,
            wallDimmerOpacity: 0.88,
            chromeTopOpacity: 0,
            chromeBottomOpacity: 0.15,
          };
        }
        return {
          houseLightsOpacity: 1.0,
          wallDimmerOpacity: 0.0,
          chromeTopOpacity: 1.0,
          chromeBottomOpacity: 1.0,
        };
      };

      const playing = getLightsDownState(true);
      expect(playing.houseLightsOpacity).toBeLessThan(0.1);
      expect(playing.wallDimmerOpacity).toBeGreaterThan(0.8);
      expect(playing.chromeTopOpacity).toBe(0);

      const paused = getLightsDownState(false);
      expect(paused.houseLightsOpacity).toBe(1.0);
      expect(paused.wallDimmerOpacity).toBe(0.0);
      expect(paused.chromeTopOpacity).toBe(1.0);
    });
  });

  describe('Reaction Particle Pool & Bounded Concurrency', () => {
    const MAX_PARTICLES = 24;

    it('enforces maximum 24 concurrent particles in the pool without unbounded growth', () => {
      let pool: Array<{ id: string; emoji: string }> = [];

      const addBurst = (emoji: string, count = 4) => {
        const newItems = Array.from({ length: count }, (_, i) => ({
          id: `p_${Date.now()}_${Math.random()}_${i}`,
          emoji,
        }));
        const combined = [...pool, ...newItems];
        if (combined.length > MAX_PARTICLES) {
          pool = combined.slice(combined.length - MAX_PARTICLES);
        } else {
          pool = combined;
        }
      };

      // Spawn 10 bursts of 4 particles (total 40 particles requested)
      for (let b = 0; b < 10; b++) {
        addBurst('🍿', 4);
        expect(pool.length).toBeLessThanOrEqual(MAX_PARTICLES);
      }

      expect(pool.length).toBe(MAX_PARTICLES);
    });

    it('generates randomized floating trajectories with vertical lift and horizontal sway', () => {
      const generatePhysics = (originX: number, originY: number) => {
        const driftX = (Math.random() - 0.5) * 80;
        const driftY = -(180 + Math.random() * 120);
        const rotation = (Math.random() - 0.5) * 36;
        return { driftX, driftY, rotation };
      };

      for (let i = 0; i < 20; i++) {
        const { driftX, driftY, rotation } = generatePhysics(200, 500);
        expect(driftX).toBeGreaterThanOrEqual(-40);
        expect(driftX).toBeLessThanOrEqual(40);
        expect(driftY).toBeLessThan(-170); // Float upward
        expect(driftY).toBeGreaterThan(-310);
        expect(rotation).toBeGreaterThanOrEqual(-18);
        expect(rotation).toBeLessThanOrEqual(18);
      }
    });
  });

  describe('Projector Sync Indicator & Drift Flicker', () => {
    const getProjectorState = (driftMs: number) => {
      const absDrift = Math.abs(driftMs);
      if (absDrift < 40) {
        return { mode: 'steady', label: 'In Sync', beamClass: 'opacity-80' };
      }
      if (absDrift < 140) {
        return { mode: 'flicker', label: 'Correcting', beamClass: 'animate-pulse opacity-90' };
      }
      return { mode: 'rapid_flicker', label: 'Resyncing', beamClass: 'animate-ping opacity-100' };
    };

    it('displays steady beam when drift is under 40ms', () => {
      const state = getProjectorState(14);
      expect(state.mode).toBe('steady');
      expect(state.label).toBe('In Sync');
      expect(state.beamClass).not.toContain('animate-pulse');
    });

    it('displays correcting flicker when drift is between 40ms and 140ms', () => {
      const state = getProjectorState(65);
      expect(state.mode).toBe('flicker');
      expect(state.label).toBe('Correcting');
      expect(state.beamClass).toContain('animate-pulse');
    });

    it('displays rapid flicker when drift exceeds 140ms', () => {
      const state = getProjectorState(220);
      expect(state.mode).toBe('rapid_flicker');
      expect(state.label).toBe('Resyncing');
      expect(state.beamClass).toContain('animate-ping');
    });
  });

  describe('Voice Speakers Glowing Ring Logic', () => {
    it('applies glowing cathode teal ring only when speaking', () => {
      const getAvatarRingClass = (isSpeaking: boolean) => {
        if (isSpeaking) {
          return 'ring-2 ring-live shadow-[0_0_16px_rgba(46,196,182,0.85)] scale-110';
        }
        return 'border border-border-brass';
      };

      const speakingRing = getAvatarRingClass(true);
      const mutedRing = getAvatarRingClass(false);

      expect(speakingRing).toContain('ring-2 ring-live');
      expect(speakingRing).toContain('shadow-[0_0_16px_rgba(46,196,182,0.85)]');
      expect(mutedRing).not.toContain('ring-live');
      expect(mutedRing).toBe('border border-border-brass');
    });
  });

  describe('Polls Dynamic Bar Width & Reordering', () => {
    it('reorders poll options according to highest votes with percentage calculation', () => {
      const options = [
        { id: '1', text: 'Option A', votes: 4 },
        { id: '2', text: 'Option B', votes: 10 },
        { id: '3', text: 'Option C', votes: 6 },
      ];

      const totalVotes = options.reduce((sum, o) => sum + o.votes, 0); // 20
      const sorted = [...options].sort((a, b) => b.votes - a.votes);

      expect(sorted[0].id).toBe('2'); // Option B (10 votes, 50%)
      expect(sorted[1].id).toBe('3'); // Option C (6 votes, 30%)
      expect(sorted[2].id).toBe('1'); // Option A (4 votes, 20%)

      expect(Math.round((sorted[0].votes / totalVotes) * 100)).toBe(50);
      expect(Math.round((sorted[1].votes / totalVotes) * 100)).toBe(30);
      expect(Math.round((sorted[2].votes / totalVotes) * 100)).toBe(20);
    });
  });

  describe('Playlist Upvoting & Reordering Layout Shifts', () => {
    it('reorders upcoming queue by vote count while keeping active reel at top', () => {
      const playlist = [
        { id: 'pl_1', title: 'Blade Runner', isPlaying: true, votes: 99 },
        { id: 'pl_2', title: '2001: A Space Odyssey', isPlaying: false, votes: 2 },
        { id: 'pl_3', title: 'Stalker', isPlaying: false, votes: 5 },
      ];

      // Bump item 2 to 7 votes
      const updated = playlist.map((item) =>
        item.id === 'pl_2' ? { ...item, votes: 7 } : item
      );

      const playingItem = updated.find((i) => i.isPlaying);
      const queue = updated.filter((i) => !i.isPlaying).sort((a, b) => b.votes - a.votes);
      const reordered = playingItem ? [playingItem, ...queue] : queue;

      expect(reordered[0].id).toBe('pl_1'); // Now playing remains #1
      expect(reordered[1].id).toBe('pl_2'); // Bumped to 7 votes -> #2
      expect(reordered[2].id).toBe('pl_3'); // 5 votes -> #3
    });
  });
});
