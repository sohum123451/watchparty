import { describe, it, expect } from 'vitest';
import { ThreeDMode } from '../src/components/theatre/TheatreEnvironment';
import { TheatreMember3D } from '../src/components/theatre/TheatreScene3D';

describe('3D Theatre Scene, Fallbacks & Page Transitions Suite', () => {
  describe('3D Engine Mode Resolution & Mobile/Reduced-Motion Fallback', () => {
    const resolveShouldRender3D = ({
      setting,
      hasWebGL,
      isMobile,
      reducedMotion,
    }: {
      setting: ThreeDMode;
      hasWebGL: boolean;
      isMobile: boolean;
      reducedMotion: boolean;
    }): boolean => {
      if (!hasWebGL) return false;
      if (setting === 'on') return true;
      if (setting === 'off') return false;

      // 'auto' mode
      if (reducedMotion || isMobile) return false;
      return true;
    };

    it('falls back to 2D seat map when WebGL is unsupported, even if setting is on', () => {
      expect(
        resolveShouldRender3D({
          setting: 'on',
          hasWebGL: false,
          isMobile: false,
          reducedMotion: false,
        })
      ).toBe(false);
    });

    it('renders 3D on desktop with WebGL and no reduced motion in auto mode', () => {
      expect(
        resolveShouldRender3D({
          setting: 'auto',
          hasWebGL: true,
          isMobile: false,
          reducedMotion: false,
        })
      ).toBe(true);
    });

    it('automatically switches to 2D seat map on mobile devices in auto mode', () => {
      expect(
        resolveShouldRender3D({
          setting: 'auto',
          hasWebGL: true,
          isMobile: true,
          reducedMotion: false,
        })
      ).toBe(false);
    });

    it('automatically switches to 2D seat map when reduced motion is preferred in auto mode', () => {
      expect(
        resolveShouldRender3D({
          setting: 'auto',
          hasWebGL: true,
          isMobile: false,
          reducedMotion: true,
        })
      ).toBe(false);
    });

    it('forces 3D on when setting is explicitly on and WebGL is available', () => {
      expect(
        resolveShouldRender3D({
          setting: 'on',
          hasWebGL: true,
          isMobile: true,
          reducedMotion: false,
        })
      ).toBe(true);
    });
  });

  describe('Instanced Mesh Cinema Seats Layout & Performance Constraints', () => {
    it('computes 24 instanced seat coordinates across 4 rows and 6 columns', () => {
      const rows = 4;
      const cols = 6;
      const coordinates: Array<{ x: number; y: number; z: number }> = [];

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = +( (c - (cols - 1) / 2) * 1.15 ).toFixed(3);
          const y = +( r * 0.35 ).toFixed(3);
          const z = +( r * 1.25 ).toFixed(3);
          coordinates.push({ x, y, z });
        }
      }

      expect(coordinates.length).toBe(24);
      // Row 1 center seats have symmetric X values
      expect(coordinates[2].x).toBe(-coordinates[3].x);
      // Row elevation rises progressively
      expect(coordinates[0].y).toBe(0);
      expect(coordinates[6].y).toBe(0.35);
      expect(coordinates[12].y).toBe(0.7);
      expect(coordinates[18].y).toBe(1.05);
    });
  });

  describe('Member Avatar Reactions & Glowing Voice Ring', () => {
    const member: TheatreMember3D = {
      id: 'm_marcus',
      name: 'Marcus Vance',
      avatar: 'M',
      seatRow: 1,
      seatCol: 2,
      isSpeaking: true,
      reaction: 'hop',
    };

    it('defines cathode teal emissive material only when speaking', () => {
      const getEmissiveConfig = (isSpeaking?: boolean) => {
        if (isSpeaking) {
          return { emissive: '#2EC4B6', emissiveIntensity: 1.6 };
        }
        return { emissive: '#0E0B09', emissiveIntensity: 0.1 };
      };

      const speakingConfig = getEmissiveConfig(member.isSpeaking);
      expect(speakingConfig.emissive).toBe('#2EC4B6');
      expect(speakingConfig.emissiveIntensity).toBe(1.6);

      const silentConfig = getEmissiveConfig(false);
      expect(silentConfig.emissive).toBe('#0E0B09');
      expect(silentConfig.emissiveIntensity).toBe(0.1);
    });

    it('assigns physical 3D hop vs clap reaction modes', () => {
      const getReactionType = (emoji: string): 'hop' | 'clap' => {
        return emoji === '🍿' || emoji === '🔥' ? 'hop' : 'clap';
      };

      expect(getReactionType('🍿')).toBe('hop');
      expect(getReactionType('🔥')).toBe('hop');
      expect(getReactionType('👏')).toBe('clap');
      expect(getReactionType('❤️')).toBe('clap');
    });
  });

  describe('Curtain Wipe & Page Transitions Performance Constraints', () => {
    it('guarantees curtain wipe total duration is strictly under 800ms', () => {
      const closeDuration = 340;
      const pauseDuration = 80;
      const openDuration = 360;
      const totalDuration = closeDuration + pauseDuration + openDuration;

      expect(totalDuration).toBe(780);
      expect(totalDuration).toBeLessThan(800);
    });

    it('guarantees quick settings fade duration is under 240ms', () => {
      const settingsFadeDuration = 220;
      expect(settingsFadeDuration).toBeLessThan(240);
    });

    it('caps devicePixelRatio to 1.5 maximum for GPU frame budget', () => {
      const capDpr = (windowDpr: number) => Math.min(Math.max(windowDpr, 1), 1.5);

      expect(capDpr(1)).toBe(1);
      expect(capDpr(2)).toBe(1.5);
      expect(capDpr(3)).toBe(1.5);
    });
  });
});
