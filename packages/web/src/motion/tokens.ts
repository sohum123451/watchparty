/**
 * Watch Party Motion System Tokens
 * Concept: "The Private Cinema"
 * All motion durations, easings, and stagger values in one authoritative file.
 */

import { cubicBezier, spring, linear } from 'animejs';

/**
 * Standard duration tokens (ms)
 */
export const MotionDurations = {
  instant: 0,       // Fallback for prefers-reduced-motion
  micro: 120,       // 120ms: Micro-interactions, button presses, focus rings
  snappy: 240,      // 240ms: Tooltips, dropdown pops, badge entries, toggles
  cinematic: 480,   // 480ms: Card reveals, ticket tears, dialog curtains
  ambient: 800,     // 800ms: Projector light bloom, marquee filament breathing
} as const;

export type MotionDurationKey = keyof typeof MotionDurations;

/**
 * Authoritative Easings
 * - Snappy "out": Sharp deceleration for instant tactile response
 * - Cinematic "inOut": Symmetrical theatrical acceleration & deceleration
 * - Springy: Organic physical bounce for tactile admission stubs & faders
 */
export const MotionEasings = {
  // Snappy "out": fast initial velocity with smooth, precise lock-in
  snappyOut: cubicBezier(0.16, 1, 0.3, 1),
  snappyOutString: 'cubicBezier(0.16, 1, 0.3, 1)',

  // Cinematic "inOut": smooth curtain glide, theatrical ease
  cinematicInOut: cubicBezier(0.65, 0, 0.35, 1),
  cinematicInOutString: 'cubicBezier(0.65, 0, 0.35, 1)',

  // Springy: natural mechanical inertia (bounce 0.35, 480ms)
  springy: spring({ bounce: 0.35, duration: 480 }),

  // Linear / Flat: strictly for non-reduced tickers or fallback fades
  linear: linear,
} as const;

/**
 * Stagger tokens (ms delay between sibling elements)
 */
export const MotionStaggers = {
  tight: 40,        // 40ms: Code segments, barcodes, reaction pills
  cinematic: 80,    // 80ms: Grid cards, ticket stubs, marquee bulb sequences
  spacious: 120,    // 120ms: Major layout sections, hero items
} as const;

/**
 * Motion Presets
 * Pre-configured animation configurations adhering to the <10% accent rule
 * and hardware acceleration constraints (transform / opacity ONLY).
 */
export const MotionPresets = {
  // Route / Page Transition
  pageEnter: {
    opacity: [0, 1],
    translateY: [8, 0],
    duration: MotionDurations.cinematic,
    ease: MotionEasings.snappyOut,
  },
  pageExit: {
    opacity: [1, 0],
    translateY: [0, -6],
    duration: MotionDurations.snappy,
    ease: MotionEasings.cinematicInOut,
  },

  // Ticket Stub Punch & Tear
  ticketTear: {
    scale: [1, 0.97, 1],
    rotate: [0, -0.8, 0],
    duration: MotionDurations.snappy,
    ease: MotionEasings.springy,
  },

  // Modal / Curtain Drop
  curtainDrop: {
    opacity: [0, 1],
    scale: [0.96, 1],
    translateY: [-10, 0],
    duration: MotionDurations.cinematic,
    ease: MotionEasings.snappyOut,
  },

  // Reduced Motion Safe Fallback
  reducedFade: {
    opacity: [0, 1],
    duration: MotionDurations.micro,
    ease: MotionEasings.linear,
  },
} as const;
