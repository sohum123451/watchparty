/**
 * Watch Party Design System Tokens
 * Concept: "The Private Cinema"
 * A warm, dark, tactile movie-theatre lobby: projector light, velvet, marquee bulbs, film grain, ticket stubs.
 */

export const CinemaColors = {
  // Base Palette (Dark Theme Only)
  bg: '#0E0B09', // Warm black (cinema darkness, void)
  surface: '#1A1512', // Primary velvet surface (cards, sidebars, panels)
  surface2: '#261E19', // Secondary surface (elevated cards, faders, modal bodies)
  surface3: '#362B24', // Tertiary surface (subtle highlights, active item fills)
  
  // Text Tokens
  text: '#F3E9DC', // Warm cream (high contrast reading text)
  muted: '#A89B8C', // Muted oyster / warm parchment (secondary labels, captions)
  mutedDark: '#675C51', // Deep muted (dividers, disabled glyphs, timestamps)

  // Accents (Strictly <10% screen budget. Zero purple/blue gradients)
  accent: '#FF9F1C', // Projector amber (spotlight focus, primary actions, active timeline)
  accent2: '#E4572E', // Marquee red (incandescent alert, recording, destructive flash)
  
  // Status Indicators
  live: '#2EC4B6', // Live presence / connected beacon (phosphor teal cathode)
  danger: '#D62839', // Critical error / ticket invalid / emergency ejection
  
  // Borders & Trim
  borderSubtle: 'rgba(243, 233, 220, 0.07)',
  borderBrass: 'rgba(243, 233, 220, 0.15)',
  borderBrassBright: 'rgba(255, 159, 28, 0.45)',
  
  // Atmospheric Glows
  accentGlow: 'rgba(255, 159, 28, 0.22)',
  accent2Glow: 'rgba(228, 87, 46, 0.25)',
  liveGlow: 'rgba(46, 196, 182, 0.30)',
  dangerGlow: 'rgba(214, 40, 57, 0.30)',
} as const;

export const CinemaTypography = {
  fonts: {
    display: "'Fraunces', 'Bricolage Grotesque', Georgia, serif",
    ui: "'DM Sans', 'Instrument Sans', system-ui, -apple-system, sans-serif",
    mono: "'JetBrains Mono', 'Fira Code', monospace",
  },
  scale: {
    xs: { fontSize: '0.75rem', lineHeight: '1rem', letterSpacing: '0.01em' }, // 12px
    sm: { fontSize: '0.875rem', lineHeight: '1.25rem', letterSpacing: '0' }, // 14px
    base: { fontSize: '1rem', lineHeight: '1.5rem', letterSpacing: '-0.01em' }, // 16px
    lg: { fontSize: '1.125rem', lineHeight: '1.625rem', letterSpacing: '-0.015em' }, // 18px
    xl: { fontSize: '1.25rem', lineHeight: '1.75rem', letterSpacing: '-0.02em' }, // 20px
    '2xl': { fontSize: '1.5rem', lineHeight: '2rem', letterSpacing: '-0.025em' }, // 24px
    '3xl': { fontSize: '1.875rem', lineHeight: '2.25rem', letterSpacing: '-0.03em' }, // 30px
    '4xl': { fontSize: '2.25rem', lineHeight: '2.5rem', letterSpacing: '-0.035em' }, // 36px
    '5xl': { fontSize: '3rem', lineHeight: '1.1', letterSpacing: '-0.04em' }, // 48px
  },
  displayTracking: '-0.035em', // Tight display tracking for headlines
  chatLeading: '1.625', // Generous line-height for chat messages
} as const;

export const CinemaSpacing = {
  0: '0px',
  0.5: '2px',
  1: '4px',
  1.5: '6px',
  2: '8px',
  2.5: '10px',
  3: '12px',
  4: '16px',
  5: '20px',
  6: '24px',
  8: '32px',
  10: '40px',
  12: '48px',
  16: '64px',
  20: '80px',
  24: '96px',
} as const;

export const CinemaRadii = {
  none: '0px',
  sm: '2px', // Tactile, architectural, crisp
  md: '4px', // Standard buttons, inputs, badge frames
  lg: '6px', // Cards, drawers
  ticket: '8px', // Ticket stubs with cutouts
  pill: '9999px', // Marquee status pills, presence badges
} as const;

export const CinemaShadows = {
  velvetDepressed: 'inset 0 2px 4px rgba(0, 0, 0, 0.7)',
  velvetRaised: '0 4px 16px -2px rgba(0, 0, 0, 0.65), 0 2px 6px rgba(0, 0, 0, 0.45)',
  projectorBeam: '0 0 40px -10px rgba(255, 159, 28, 0.28), 0 0 80px -20px rgba(255, 159, 28, 0.12)',
  marqueeBulbGlow: '0 0 12px rgba(255, 159, 28, 0.55), 0 0 24px rgba(255, 159, 28, 0.25)',
  cathodeBeacon: '0 0 10px rgba(46, 196, 182, 0.6), 0 0 20px rgba(46, 196, 182, 0.2)',
  dangerBurn: '0 0 16px rgba(214, 40, 57, 0.45)',
} as const;

export const CinemaAtmosphere = {
  filmGrainSvgDataUri:
    "data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='0.035'/%3E%3C/svg%3E",
  projectorConeGradient:
    'radial-gradient(ellipse 70% 50% at 50% -20%, rgba(255, 159, 28, 0.12) 0%, rgba(255, 159, 28, 0.03) 45%, transparent 75%)',
  velvetCurtainGradient:
    'linear-gradient(180deg, rgba(26, 21, 18, 0.95) 0%, rgba(14, 11, 9, 0.98) 100%)',
} as const;
