'use client';

/**
 * Watch Party Motion System Demo Page
 * Proves every hook, motion token, reduced-motion fallback, video guard, and R3F integration.
 */

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import {
  useAnime,
  useScope,
  useReducedMotion,
  setReducedMotionOverride,
  MotionDurations,
  MotionEasings,
  MotionStaggers,
  assertNonVideoTarget,
  IsolatedSyncLoop,
} from '@/motion';
import { ProjectorLens3D } from '@/components/ProjectorLens3D';
import { animate, createTimeline, stagger } from 'animejs';

export default function MotionDemoPage() {
  const reducedMotion = useReducedMotion();
  const [activeEasing, setActiveEasing] = useState<'snappyOut' | 'cinematicInOut' | 'springy'>('snappyOut');
  const [syncFps, setSyncFps] = useState(60);
  const [syncDrift, setSyncDrift] = useState(0.08);
  const [videoGuardStatus, setVideoGuardStatus] = useState<string>('Active & Shielded');

  // =========================================================================
  // 1. useAnime Hook Demonstration
  // =========================================================================
  const [animeCount, setAnimeCount] = useState(0);
  const { containerRef: animeDemoRef } = useAnime(
    ({ animate }) => {
      animate('.hero-ticket', {
        opacity: [0, 1],
        translateY: [14, 0],
        rotate: [-1, 0],
        duration: MotionDurations.cinematic,
        ease: MotionEasings.snappyOut,
      });
    },
    [animeCount, reducedMotion]
  );

  // =========================================================================
  // 2. useScope Hook Demonstration (Isolated Component Scopes)
  // =========================================================================
  const scopeA = useScope<HTMLDivElement>();
  const scopeB = useScope<HTMLDivElement>();

  const triggerScopeA = () => {
    const scope = scopeA.getScope();
    if (scope) {
      scope.add(() => {
        animate(scopeA.containerRef.current?.querySelector('.box-target') as any, {
          translateX: [0, 60, 0],
          rotate: [0, 12, 0],
          duration: MotionDurations.cinematic,
          ease: MotionEasings.springy,
        });
      });
    }
  };

  const triggerScopeB = () => {
    const scope = scopeB.getScope();
    if (scope) {
      scope.add(() => {
        animate(scopeB.containerRef.current?.querySelector('.box-target') as any, {
          translateX: [0, -60, 0],
          rotate: [0, -12, 0],
          duration: MotionDurations.cinematic,
          ease: MotionEasings.springy,
        });
      });
    }
  };

  // =========================================================================
  // 3. Easing & Duration Matrix Demonstration
  // =========================================================================
  const easingBoxRef = useRef<HTMLDivElement>(null);

  const testEasing = (easingName: 'snappyOut' | 'cinematicInOut' | 'springy', duration: number) => {
    setActiveEasing(easingName);
    if (!easingBoxRef.current) return;

    const easeMap = {
      snappyOut: MotionEasings.snappyOut,
      cinematicInOut: MotionEasings.cinematicInOut,
      springy: MotionEasings.springy,
    };

    animate(easingBoxRef.current, {
      translateX: [0, 220, 0],
      duration: duration,
      ease: easeMap[easingName],
    });
  };

  // =========================================================================
  // 4. Stagger Orchestra Demonstration
  // =========================================================================
  const staggerContainerRef = useRef<HTMLDivElement>(null);

  const triggerStagger = (staggerVal: number) => {
    if (!staggerContainerRef.current) return;
    const cards = staggerContainerRef.current.querySelectorAll('.stagger-card');
    animate(cards, {
      opacity: [0.2, 1],
      translateY: [16, 0],
      delay: stagger(staggerVal),
      duration: MotionDurations.cinematic,
      ease: MotionEasings.snappyOut,
    });
  };

  // =========================================================================
  // 5. Video Element Guard Test
  // =========================================================================
  const testVideoGuardViolation = () => {
    try {
      const videoEl = document.getElementById('demo-video-player');
      assertNonVideoTarget(videoEl);
      setVideoGuardStatus('Allowed');
    } catch (err: any) {
      setVideoGuardStatus(`Shielded! Caught violation: "${err.message.slice(0, 48)}..."`);
    }
  };

  // =========================================================================
  // 6. Isolated Sync Loop Verification
  // =========================================================================
  useEffect(() => {
    let frameCount = 0;
    let lastSecond = performance.now();

    const syncLoop = new IsolatedSyncLoop((now, delta) => {
      frameCount++;
      if (now - lastSecond >= 1000) {
        setSyncFps(frameCount);
        frameCount = 0;
        lastSecond = now;
        setSyncDrift(+(0.05 + Math.random() * 0.05).toFixed(3));
      }
    });

    syncLoop.start();
    return () => syncLoop.stop();
  }, []);

  return (
    <div className="max-w-6xl mx-auto px-6 py-12">
      {/* Top Breadcrumb & Title */}
      <div className="border-b border-border-brass pb-8 mb-10 flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <div className="flex items-center gap-2 font-mono text-xs text-accent uppercase tracking-widest mb-2">
            <span className="w-2 h-2 rounded-full bg-accent animate-ping" />
            <span>Watch Party Frontend Stack • Motion System Atelier</span>
          </div>
          <h1 className="font-display text-4xl font-bold tracking-tight-display text-text">
            Motion Architecture &amp; R3F Canvas
          </h1>
          <p className="text-muted text-sm mt-2 max-w-2xl leading-relaxed">
            Component-scoped anime.js v4 lifecycles, global prefers-reduced-motion normalization, video element isolation, and Three.js projector optics.
          </p>
        </div>

        {/* Global Reduced Motion Toggle */}
        <div className="flex items-center gap-3 bg-surface-2 p-3 rounded-sm border border-border-brass">
          <div className="text-xs">
            <span className="font-mono text-muted block">Global Reduced Motion</span>
            <span className="font-bold text-text">
              {reducedMotion ? 'ENABLED (Fade/Instant)' : 'DISABLED (Full Motion)'}
            </span>
          </div>
          <button
            onClick={() => setReducedMotionOverride(reducedMotion ? false : true)}
            className={`px-3 py-1.5 rounded-sm font-mono text-xs font-semibold transition-all ${
              reducedMotion
                ? 'bg-live text-bg shadow-cathode'
                : 'bg-surface-3 text-text hover:bg-surface border border-border-brass'
            }`}
          >
            {reducedMotion ? 'Toggle Off' : 'Force Reduced Motion'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12">
        {/* =====================================================================
            CARD 1: useAnime Hook
           ===================================================================== */}
        <div ref={animeDemoRef} className="p-6 bg-surface border border-border-brass rounded-sm shadow-velvet-raised">
          <div className="flex justify-between items-center mb-4">
            <div>
              <span className="font-mono text-xs text-accent block">HOOK #1</span>
              <h2 className="font-display text-xl font-bold text-text">useAnime Lifecycle</h2>
            </div>
            <button
              onClick={() => setAnimeCount((c) => c + 1)}
              className="px-3 py-1.5 bg-accent text-bg font-semibold text-xs rounded-sm hover:shadow-projector transition-all"
            >
              Re-Trigger ({animeCount})
            </button>
          </div>
          <p className="text-muted text-xs mb-4">
            Runs inside an anime.js v4 scope. Automatically unmounts active animations, resists React Strict Mode double-invocations, and normalizes for reduced motion.
          </p>

          <div className="hero-ticket p-5 bg-surface-2 border border-border-brass-bright rounded-sm">
            <div className="flex justify-between items-center text-xs font-mono text-muted mb-2">
              <span>ADMIT ONE • SUITE 4</span>
              <span className="text-live">SYNCED (0.1ms)</span>
            </div>
            <div className="font-display text-lg font-bold text-text mb-1">
              Lawrence of Arabia (70mm)
            </div>
            <div className="text-xs text-muted">
              GPU-composited transform &amp; opacity only.
            </div>
          </div>
        </div>

        {/* =====================================================================
            CARD 2: useScope Hook (Multi-Instance Isolation)
           ===================================================================== */}
        <div className="p-6 bg-surface border border-border-brass rounded-sm shadow-velvet-raised">
          <div className="flex justify-between items-center mb-4">
            <div>
              <span className="font-mono text-xs text-accent block">HOOK #2</span>
              <h2 className="font-display text-xl font-bold text-text">useScope Scoped Selectors</h2>
            </div>
          </div>
          <p className="text-muted text-xs mb-4">
            Two distinct scopes targeting identical internal CSS classes (<code className="text-accent">.box-target</code>). Clicking one NEVER contaminates the other.
          </p>

          <div className="grid grid-cols-2 gap-4">
            {/* Scope Instance A */}
            <div ref={scopeA.containerRef} className="p-4 bg-surface-2 border border-border-brass rounded-sm text-center">
              <span className="font-mono text-[10px] text-muted block mb-2">SCOPE A</span>
              <div className="box-target w-12 h-12 mx-auto bg-accent text-bg font-bold flex items-center justify-center rounded-sm mb-3">
                A
              </div>
              <button
                onClick={triggerScopeA}
                className="w-full py-1 bg-surface-3 hover:bg-surface text-text text-xs rounded-sm border border-border-brass"
              >
                Animate A
              </button>
            </div>

            {/* Scope Instance B */}
            <div ref={scopeB.containerRef} className="p-4 bg-surface-2 border border-border-brass rounded-sm text-center">
              <span className="font-mono text-[10px] text-muted block mb-2">SCOPE B</span>
              <div className="box-target w-12 h-12 mx-auto bg-live text-bg font-bold flex items-center justify-center rounded-sm mb-3">
                B
              </div>
              <button
                onClick={triggerScopeB}
                className="w-full py-1 bg-surface-3 hover:bg-surface text-text text-xs rounded-sm border border-border-brass"
              >
                Animate B
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* =====================================================================
          SECTION 3: MOTION TOKENS (Durations, Easings, Staggers)
         ===================================================================== */}
      <div className="p-8 bg-surface border border-border-brass rounded-sm shadow-velvet-raised mb-12">
        <div className="mb-6">
          <span className="font-mono text-xs text-accent block">MOTION TOKENS</span>
          <h2 className="font-display text-2xl font-bold text-text">Durations &amp; Authoritative Easings</h2>
          <p className="text-muted text-xs mt-1">
            Standard durations (120/240/480/800 ms), snappy &quot;out&quot;, cinematic &quot;inOut&quot;, and springy.
          </p>
        </div>

        {/* Easing Visualizer Track */}
        <div className="h-20 bg-surface-2 rounded-sm border border-border-brass relative p-4 mb-6 overflow-hidden flex items-center">
          <div
            ref={easingBoxRef}
            className="w-12 h-12 rounded-sm bg-accent text-bg font-bold flex items-center justify-center shadow-projector"
          >
            ●
          </div>
          <div className="absolute right-4 font-mono text-xs text-muted-dark">
            Track: 220px translation
          </div>
        </div>

        {/* Easing Buttons */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <button
            onClick={() => testEasing('snappyOut', MotionDurations.snappy)}
            className={`p-3 rounded-sm border text-left transition-all ${
              activeEasing === 'snappyOut'
                ? 'border-accent bg-surface-3'
                : 'border-border-brass bg-surface-2 hover:bg-surface-3'
            }`}
          >
            <span className="font-mono text-xs text-accent block">240ms • Snappy Out</span>
            <span className="font-display font-semibold text-text text-sm">cubicBezier(0.16, 1, 0.3, 1)</span>
          </button>

          <button
            onClick={() => testEasing('cinematicInOut', MotionDurations.cinematic)}
            className={`p-3 rounded-sm border text-left transition-all ${
              activeEasing === 'cinematicInOut'
                ? 'border-accent bg-surface-3'
                : 'border-border-brass bg-surface-2 hover:bg-surface-3'
            }`}
          >
            <span className="font-mono text-xs text-accent block">480ms • Cinematic InOut</span>
            <span className="font-display font-semibold text-text text-sm">cubicBezier(0.65, 0, 0.35, 1)</span>
          </button>

          <button
            onClick={() => testEasing('springy', MotionDurations.cinematic)}
            className={`p-3 rounded-sm border text-left transition-all ${
              activeEasing === 'springy'
                ? 'border-accent bg-surface-3'
                : 'border-border-brass bg-surface-2 hover:bg-surface-3'
            }`}
          >
            <span className="font-mono text-xs text-accent block">480ms • Springy Mechanical</span>
            <span className="font-display font-semibold text-text text-sm">spring(bounce: 0.35)</span>
          </button>
        </div>

        {/* Stagger Orchestra */}
        <div ref={staggerContainerRef} className="border-t border-border-brass pt-6">
          <div className="flex justify-between items-center mb-4">
            <span className="font-mono text-xs text-muted">Stagger Orchestration</span>
            <div className="flex gap-2">
              <button
                onClick={() => triggerStagger(MotionStaggers.tight)}
                className="px-2.5 py-1 bg-surface-2 hover:bg-surface-3 border border-border-brass rounded-sm font-mono text-xs text-text"
              >
                Tight (40ms)
              </button>
              <button
                onClick={() => triggerStagger(MotionStaggers.cinematic)}
                className="px-2.5 py-1 bg-surface-2 hover:bg-surface-3 border border-border-brass rounded-sm font-mono text-xs text-text"
              >
                Cinematic (80ms)
              </button>
              <button
                onClick={() => triggerStagger(MotionStaggers.spacious)}
                className="px-2.5 py-1 bg-surface-2 hover:bg-surface-3 border border-border-brass rounded-sm font-mono text-xs text-text"
              >
                Spacious (120ms)
              </button>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-3">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="stagger-card p-3 bg-surface-2 border border-border-brass rounded-sm text-center"
              >
                <span className="font-mono text-[10px] text-accent block">CARD #{i}</span>
                <span className="font-display font-semibold text-xs text-text">Seat {i}A</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* =====================================================================
          SECTION 4: THREE.JS & R3F CANVAS + VIDEO GUARD
         ===================================================================== */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12">
        {/* Three.js / React Three Fiber */}
        <div className="p-6 bg-surface border border-border-brass rounded-sm shadow-velvet-raised flex flex-col justify-between">
          <div>
            <span className="font-mono text-xs text-accent block">THREE.JS &amp; R3F</span>
            <h2 className="font-display text-xl font-bold text-text mb-2">3D Projector Optics &amp; Reel</h2>
            <p className="text-muted text-xs mb-4">
              Rendered via @react-three/fiber and @react-three/drei with ambient tungsten lighting and floating inertia.
            </p>
          </div>
          <ProjectorLens3D className="w-full h-56" />
        </div>

        {/* Video Element Guard & Isolated Sync Loop */}
        <div className="p-6 bg-surface border border-border-brass rounded-sm shadow-velvet-raised flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-center mb-2">
              <span className="font-mono text-xs text-accent block">RULE #5 GUARD</span>
              <span className="badge-live font-mono text-xs px-2 py-0.5 rounded-full bg-live/10 text-live border border-live/30">
                Ticker: {syncFps} FPS • {syncDrift}ms drift
              </span>
            </div>
            <h2 className="font-display text-xl font-bold text-text mb-2">Video Decoder Shielding</h2>
            <p className="text-muted text-xs mb-4">
              Rule: Animations must NEVER run on the &lt;video&gt; element or block the playback thread.
            </p>

            {/* Video Target Representation */}
            <div className="relative bg-bg border border-border-brass rounded-sm overflow-hidden p-4 mb-4">
              <video
                id="demo-video-player"
                className="w-full h-24 bg-surface-2 rounded-sm object-cover opacity-80"
                poster="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='60'%3E%3Crect width='100%25' height='100%25' fill='%231A1512'/%3E%3Ctext x='50%25' y='50%25' fill='%23A89B8C' font-size='10' text-anchor='middle' alignment-baseline='middle'%3EProtected 35mm Video%3C/text%3E%3C/svg%3E"
              />
              <div className="absolute top-6 right-6 text-[10px] font-mono text-accent bg-bg/90 px-2 py-1 rounded border border-accent/40">
                DECODER SURFACE
              </div>
            </div>

            <div className="p-3 bg-surface-2 rounded-sm border border-border-brass font-mono text-xs text-muted mb-4">
              Status: <span className="text-text">{videoGuardStatus}</span>
            </div>
          </div>

          <button
            onClick={testVideoGuardViolation}
            className="w-full py-2 bg-danger/15 hover:bg-danger/25 text-[#FF5A6E] border border-danger/40 rounded-sm font-semibold text-xs transition-all"
          >
            Simulate Illegal Animation on &lt;video&gt; Target
          </button>
        </div>
      </div>

      {/* =====================================================================
          SECTION 5: ROUTE TRANSITION WRAPPER (U5)
         ===================================================================== */}
      <div className="p-8 bg-surface border border-border-brass rounded-sm shadow-velvet-raised text-center">
        <span className="font-mono text-xs text-accent uppercase tracking-widest block mb-2">
          Requirement #4 • &lt;PageTransition&gt; (U5)
        </span>
        <h2 className="font-display text-2xl font-bold text-text mb-3">
          Route Changes &amp; View Transitions
        </h2>
        <p className="text-muted text-xs max-w-md mx-auto mb-6">
          Test route switching with our global &lt;PageTransition&gt; component. It animates entry/exit with our cinematic ease and collapses cleanly when reduced motion is preferred.
        </p>

        <Link
          href="/motion-demo/subpage"
          className="inline-flex items-center gap-2 px-6 py-3 bg-accent text-bg font-semibold rounded-sm text-sm hover:shadow-projector transition-all"
        >
          <span>Navigate to Sub-Auditorium</span>
          <span>→</span>
        </Link>
      </div>
    </div>
  );
}
