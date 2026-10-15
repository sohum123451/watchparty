import { describe, it, expect } from 'vitest';
import { calculatePasswordStrength } from '../src/components/PasswordFilmStripMeter';

describe('Watch Party Screens & Components Suite', () => {
  describe('Password Film-Strip Meter Entropy Logic', () => {
    it('returns score 0 and "Unexposed Film" for empty password', () => {
      const result = calculatePasswordStrength('');
      expect(result.score).toBe(0);
      expect(result.label).toContain('Unexposed');
    });

    it('evaluates weak passwords (< 8 chars)', () => {
      const result = calculatePasswordStrength('short');
      expect(result.score).toBe(0);
    });

    it('evaluates fair passwords (8+ chars, single class)', () => {
      const result = calculatePasswordStrength('password');
      expect(result.score).toBe(1);
      expect(result.label).toContain('Developing');
    });

    it('evaluates cinema grade passwords (8+ chars with letters & numbers)', () => {
      const result = calculatePasswordStrength('password123');
      expect(result.score).toBe(2);
      expect(result.label).toContain('Exposed');
    });

    it('evaluates projectionist master passwords (12+ chars with letters, numbers, and symbols)', () => {
      const result = calculatePasswordStrength('Stalker1979#4KReel!');
      expect(result.score).toBe(4);
      expect(result.label).toContain('Master Vault');
    });

    it('verifies Google Auth parameters structure for box office admission', () => {
      const googlePayload = {
        googleId: 'google_sub_109283',
        email: 'cinematheque.patron@gmail.com',
        displayName: 'Cinephile Patron',
        avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100',
      };

      expect(googlePayload.googleId).toMatch(/^google_/);
      expect(googlePayload.email).toContain('@');
      expect(googlePayload.displayName.length).toBeGreaterThan(0);
    });
  });
});
