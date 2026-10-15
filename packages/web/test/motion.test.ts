import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  MotionDurations,
  MotionEasings,
  MotionStaggers,
  isReducedMotion,
  setReducedMotionOverride,
  getAccessibleMotionParams,
  assertNonVideoTarget,
  assertHardwareAcceleratedProps,
  IsolatedSyncLoop,
} from '../src/motion';

describe('Watch Party Motion System Suite', () => {
  beforeEach(() => {
    setReducedMotionOverride(null);
  });

  afterEach(() => {
    setReducedMotionOverride(null);
  });

  describe('1. Motion Tokens', () => {
    it('defines authoritative durations: 120, 240, 480, 800 ms', () => {
      expect(MotionDurations.instant).toBe(0);
      expect(MotionDurations.micro).toBe(120);
      expect(MotionDurations.snappy).toBe(240);
      expect(MotionDurations.cinematic).toBe(480);
      expect(MotionDurations.ambient).toBe(800);
    });

    it('defines snappy "out", cinematic "inOut", and springy mechanical easings', () => {
      expect(MotionEasings.snappyOut).toBeDefined();
      expect(typeof MotionEasings.snappyOut).toBe('function');

      expect(MotionEasings.cinematicInOut).toBeDefined();
      expect(typeof MotionEasings.cinematicInOut).toBe('function');

      expect(MotionEasings.springy).toBeDefined();
      expect(typeof MotionEasings.springy).toBe('object');
    });

    it('defines stagger values: 40, 80, 120 ms', () => {
      expect(MotionStaggers.tight).toBe(40);
      expect(MotionStaggers.cinematic).toBe(80);
      expect(MotionStaggers.spacious).toBe(120);
    });
  });

  describe('2. prefers-reduced-motion Support', () => {
    it('respects global override flag', () => {
      setReducedMotionOverride(true);
      expect(isReducedMotion()).toBe(true);

      setReducedMotionOverride(false);
      expect(isReducedMotion()).toBe(false);
    });

    it('normalizes animation parameters when reduced motion is active', () => {
      setReducedMotionOverride(true);

      const complexAnimation = {
        opacity: [0, 1],
        translateY: [20, 0],
        scale: [0.95, 1],
        rotate: [10, 0],
        duration: 480,
        delay: 80,
      };

      const accessible = getAccessibleMotionParams(complexAnimation);

      // Transforms stripped
      expect(accessible.translateY).toBeUndefined();
      expect(accessible.scale).toBeUndefined();
      expect(accessible.rotate).toBeUndefined();

      // Opacity preserved with micro duration
      expect(accessible.opacity).toEqual([0, 1]);
      expect(accessible.duration).toBe(120);
      expect(accessible.delay).toBe(0);
    });

    it('collapses to instant duration if allowFade is false', () => {
      setReducedMotionOverride(true);

      const animation = {
        opacity: [0, 1],
        translateY: [20, 0],
        duration: 480,
      };

      const accessible = getAccessibleMotionParams(animation, { allowFade: false });
      expect(accessible.duration).toBe(0);
      expect(accessible.translateY).toBeUndefined();
    });
  });

  describe('3. Video Element & Hardware Acceleration Guard (Rule #5)', () => {
    it('throws violation error if animation targets a <video> element', () => {
      const mockVideo = {
        tagName: 'VIDEO',
      } as unknown as Element;

      expect(() => {
        assertNonVideoTarget(mockVideo);
      }).toThrow(/Animations are strictly prohibited on <video> elements/);
    });

    it('allows non-video container targets', () => {
      const mockDiv = {
        tagName: 'DIV',
      } as unknown as Element;

      expect(() => {
        assertNonVideoTarget(mockDiv);
      }).not.toThrow();
    });

    it('warns in development when layout-thrashing props like width or height are animated', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      assertHardwareAcceleratedProps({
        width: 200,
        opacity: 1,
      });

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Property 'width' triggers browser layout recalculations")
      );

      warnSpy.mockRestore();
    });
  });

  describe('4. Isolated Sync Loop', () => {
    it('starts and stops cleanly without errors', () => {
      const loop = new IsolatedSyncLoop(() => {});
      expect(loop.isRunning()).toBe(false);

      loop.start();
      expect(loop.isRunning()).toBe(true);

      loop.stop();
      expect(loop.isRunning()).toBe(false);
    });
  });
});
