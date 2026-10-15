/**
 * Watch Party Design System Showcase Page
 * Route: /design
 * Concept: "The Private Cinema"
 */

export function getDesignSystemHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0">
  <title>Watch Party — Design System Atelier ("The Private Cinema")</title>
  <link rel="icon" type="image/svg+xml" href="/icon.svg">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;600;700&family=DM+Sans:ital,opsz,wght@0,9..40,400;500;600;700;1,9..40,400&family=Fraunces:ital,opsz,wght@0,9..144,400;500;600;700;800;1,9..144,400&family=Instrument+Sans:ital,wght@0,400;500;600;700;1,400&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      /* Base Colors (Dark Only) */
      --bg: #0E0B09;
      --surface: #1A1512;
      --surface-2: #261E19;
      --surface-3: #362B24;
      
      --text: #F3E9DC;
      --muted: #A89B8C;
      --muted-dark: #675C51;

      --accent: #FF9F1C;
      --accent-glow: rgba(255, 159, 28, 0.22);
      --accent-2: #E4572E;
      --accent-2-glow: rgba(228, 87, 46, 0.25);

      --live: #2EC4B6;
      --live-glow: rgba(46, 196, 182, 0.32);
      --danger: #D62839;
      --danger-glow: rgba(214, 40, 57, 0.32);

      --border-subtle: rgba(243, 233, 220, 0.08);
      --border-brass: rgba(243, 233, 220, 0.16);
      --border-brass-bright: rgba(255, 159, 28, 0.45);

      /* Typography */
      --font-display: 'Fraunces', 'Bricolage Grotesque', Georgia, serif;
      --font-ui: 'DM Sans', 'Instrument Sans', system-ui, -apple-system, sans-serif;
      --font-mono: 'JetBrains Mono', monospace;

      /* Spacing */
      --space-1: 4px;
      --space-2: 8px;
      --space-3: 12px;
      --space-4: 16px;
      --space-6: 24px;
      --space-8: 32px;
      --space-12: 48px;
      --space-16: 64px;

      /* Radii */
      --radius-sm: 2px;
      --radius-md: 4px;
      --radius-lg: 6px;
      --radius-ticket: 8px;
      --radius-pill: 9999px;

      /* Shadows & Depths */
      --shadow-surface: 0 4px 20px -4px rgba(0, 0, 0, 0.7), 0 2px 6px rgba(0, 0, 0, 0.45);
      --shadow-inset-velvet: inset 0 2px 5px rgba(0, 0, 0, 0.75);
      --shadow-projector: 0 0 35px -8px rgba(255, 159, 28, 0.28), 0 0 70px -15px rgba(255, 159, 28, 0.12);
      --shadow-cathode: 0 0 10px rgba(46, 196, 182, 0.6), 0 0 20px rgba(46, 196, 182, 0.2);

      /* Film Grain & Projector Cone */
      --film-grain-url: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='0.038'/%3E%3C/svg%3E");
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    
    body {
      background-color: var(--bg);
      color: var(--text);
      font-family: var(--font-ui);
      line-height: 1.5;
      min-height: 100vh;
      overflow-x: hidden;
      position: relative;
    }

    /* 35mm Film Grain Layer */
    #film-grain-layer {
      position: fixed;
      inset: 0;
      width: 100vw;
      height: 100vh;
      pointer-events: none;
      background-image: var(--film-grain-url);
      background-repeat: repeat;
      z-index: 99999;
      opacity: 0.85;
      transition: opacity 0.3s ease;
    }

    /* Projector Light Beam Cone (Top Spotlight) */
    #projector-beam-layer {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: 480px;
      pointer-events: none;
      background: radial-gradient(ellipse 70% 55% at 50% -25%, rgba(255, 159, 28, 0.14) 0%, rgba(255, 159, 28, 0.03) 45%, transparent 75%);
      z-index: 1;
      transition: opacity 0.4s ease;
    }

    /* Container */
    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 0 var(--space-6);
      position: relative;
      z-index: 2;
    }

    /* Marquee Top Banner */
    .marquee-bar {
      border-bottom: 1px solid var(--border-brass);
      background: rgba(14, 11, 9, 0.95);
      backdrop-filter: blur(8px);
      padding: var(--space-2) var(--space-6);
      display: flex;
      justify-content: space-between;
      align-items: center;
      position: sticky;
      top: 0;
      z-index: 100;
    }
    .marquee-bulbs {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .marquee-bulb {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--accent);
      animation: bulbFlicker 2.2s infinite ease-in-out;
    }
    .marquee-bulb:nth-child(even) {
      animation-delay: 1.1s;
      background: #FFB347;
    }
    @keyframes bulbFlicker {
      0%, 100% { opacity: 1; filter: drop-shadow(0 0 5px rgba(255, 159, 28, 0.8)); }
      50% { opacity: 0.55; filter: drop-shadow(0 0 2px rgba(255, 159, 28, 0.2)); }
    }
    .marquee-title {
      font-family: var(--font-display);
      font-size: 0.8125rem;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--text);
      display: flex;
      align-items: center;
      gap: var(--space-2);
    }
    .marquee-controls {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      font-size: 0.75rem;
    }
    .pill-toggle {
      background: var(--surface);
      border: 1px solid var(--border-brass);
      color: var(--muted);
      padding: 3px 10px;
      border-radius: var(--radius-pill);
      cursor: pointer;
      font-family: var(--font-mono);
      display: flex;
      align-items: center;
      gap: 6px;
      transition: all 0.2s;
    }
    .pill-toggle.active {
      color: var(--text);
      border-color: var(--border-brass-bright);
      background: var(--surface-2);
    }
    .pill-toggle .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--muted-dark);
    }
    .pill-toggle.active .dot {
      background: var(--live);
      box-shadow: var(--shadow-cathode);
    }

    /* Header Section */
    .hero-header {
      padding: var(--space-12) 0 var(--space-8);
      border-bottom: 1px solid var(--border-brass);
    }
    .foyer-eyebrow {
      font-family: var(--font-mono);
      font-size: 0.8125rem;
      letter-spacing: 0.08em;
      color: var(--accent);
      text-transform: uppercase;
      margin-bottom: var(--space-2);
      display: flex;
      align-items: center;
      gap: var(--space-2);
    }
    .foyer-eyebrow .ticket-mark {
      display: inline-block;
      padding: 1px 6px;
      border: 1px dashed var(--accent);
      border-radius: 2px;
      font-size: 0.7rem;
    }
    .hero-title {
      font-family: var(--font-display);
      font-size: 3.25rem;
      font-weight: 700;
      letter-spacing: -0.035em;
      line-height: 1.08;
      color: var(--text);
      margin-bottom: var(--space-4);
    }
    .hero-subtitle {
      font-size: 1.125rem;
      color: var(--muted);
      max-width: 680px;
      line-height: 1.6;
    }

    /* Section Headers */
    .section-wrap {
      padding: var(--space-12) 0;
      border-bottom: 1px solid var(--border-subtle);
    }
    .section-header {
      margin-bottom: var(--space-8);
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
    }
    .section-num {
      font-family: var(--font-mono);
      font-size: 0.8125rem;
      color: var(--accent);
      margin-bottom: var(--space-1);
    }
    .section-title {
      font-family: var(--font-display);
      font-size: 2rem;
      font-weight: 600;
      letter-spacing: -0.03em;
      color: var(--text);
    }
    .section-desc {
      font-size: 0.9375rem;
      color: var(--muted);
      margin-top: var(--space-1);
    }

    /* Accent Budget Badge */
    .budget-badge {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      background: var(--surface);
      border: 1px solid var(--border-brass);
      padding: 6px 12px;
      border-radius: var(--radius-sm);
      font-family: var(--font-mono);
      font-size: 0.75rem;
      color: var(--muted);
    }
    .budget-gauge {
      width: 48px;
      height: 6px;
      background: var(--surface-3);
      border-radius: 3px;
      overflow: hidden;
      display: inline-block;
    }
    .budget-gauge-fill {
      width: 8.5%;
      height: 100%;
      background: var(--accent);
      border-radius: 3px;
    }

    /* Swatches Grid */
    .swatches-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
      gap: var(--space-4);
    }
    .swatch-card {
      background: var(--surface);
      border: 1px solid var(--border-brass);
      border-radius: var(--radius-sm);
      overflow: hidden;
      box-shadow: var(--shadow-surface);
      transition: transform 0.2s ease, border-color 0.2s ease;
      cursor: pointer;
    }
    .swatch-card:hover {
      transform: translateY(-2px);
      border-color: var(--border-brass-bright);
    }
    .swatch-color-box {
      height: 80px;
      width: 100%;
      border-bottom: 1px solid var(--border-subtle);
      position: relative;
    }
    .swatch-color-box.has-border {
      border: 1px solid rgba(255, 255, 255, 0.1);
    }
    .swatch-info {
      padding: var(--space-3);
    }
    .swatch-name {
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--text);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .swatch-role {
      font-size: 0.75rem;
      color: var(--muted);
      margin-top: 2px;
    }
    .swatch-meta {
      font-family: var(--font-mono);
      font-size: 0.75rem;
      color: var(--muted-dark);
      margin-top: 6px;
      display: flex;
      justify-content: space-between;
    }

    /* Typography Showcase */
    .type-specimen-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--space-6);
    }
    @media (max-width: 840px) {
      .type-specimen-grid { grid-template-columns: 1fr; }
    }
    .specimen-card {
      background: var(--surface);
      border: 1px solid var(--border-brass);
      border-radius: var(--radius-sm);
      padding: var(--space-6);
    }
    .specimen-tag {
      font-family: var(--font-mono);
      font-size: 0.6875rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--accent);
      margin-bottom: var(--space-3);
      display: block;
    }
    .specimen-display {
      font-family: var(--font-display);
      font-size: 2.25rem;
      font-weight: 700;
      letter-spacing: -0.035em;
      line-height: 1.12;
      color: var(--text);
      margin-bottom: var(--space-3);
    }
    .specimen-subhead {
      font-family: 'Bricolage Grotesque', sans-serif;
      font-size: 1.25rem;
      font-weight: 600;
      letter-spacing: -0.02em;
      color: var(--text);
      margin-bottom: var(--space-3);
    }
    .specimen-body {
      font-family: var(--font-ui);
      font-size: 0.9375rem;
      line-height: 1.6;
      color: var(--muted);
    }
    .specimen-mono {
      font-family: var(--font-mono);
      font-size: 0.8125rem;
      color: var(--accent);
      background: var(--surface-2);
      padding: var(--space-3);
      border-radius: var(--radius-sm);
      border-left: 2px solid var(--accent);
      margin-top: var(--space-3);
      white-space: pre-wrap;
    }

    /* Chat Line-Height Comparison */
    .chat-comparison {
      margin-top: var(--space-6);
      background: var(--surface-2);
      border: 1px solid var(--border-brass);
      border-radius: var(--radius-sm);
      padding: var(--space-6);
    }
    .chat-bubble {
      background: var(--surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
      padding: var(--space-4);
      margin-bottom: var(--space-3);
    }
    .chat-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: var(--space-2);
      font-size: 0.8125rem;
    }
    .chat-author {
      font-weight: 600;
      color: var(--text);
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .chat-time {
      font-family: var(--font-mono);
      font-size: 0.75rem;
      color: var(--muted-dark);
    }
    .chat-body-generous {
      font-family: var(--font-ui);
      font-size: 0.9375rem;
      line-height: 1.625; /* REQUIRED GENERATION LINE-HEIGHT */
      color: var(--text);
    }

    /* Icon Set Matrix */
    .icons-matrix {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
      gap: var(--space-3);
    }
    .icon-box {
      background: var(--surface);
      border: 1px solid var(--border-brass);
      border-radius: var(--radius-sm);
      padding: var(--space-4) var(--space-2);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: var(--space-2);
      transition: all 0.2s ease;
    }
    .icon-box:hover {
      border-color: var(--accent);
      background: var(--surface-2);
      transform: translateY(-2px);
    }
    .icon-box svg {
      width: 24px;
      height: 24px;
      stroke: var(--text);
      stroke-width: 1.6;
      fill: none;
      transition: stroke 0.2s ease;
    }
    .icon-box:hover svg {
      stroke: var(--accent);
    }
    .icon-label {
      font-family: var(--font-mono);
      font-size: 0.6875rem;
      color: var(--muted);
      text-align: center;
    }

    /* Buttons Atelier */
    .atelier-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: var(--space-6);
    }
    .atelier-card {
      background: var(--surface);
      border: 1px solid var(--border-brass);
      border-radius: var(--radius-sm);
      padding: var(--space-6);
      box-shadow: var(--shadow-surface);
    }
    .atelier-card-title {
      font-family: var(--font-display);
      font-size: 1.125rem;
      font-weight: 600;
      color: var(--text);
      margin-bottom: var(--space-4);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .btn-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-3);
      margin-bottom: var(--space-4);
    }
    .state-label {
      font-family: var(--font-mono);
      font-size: 0.6875rem;
      color: var(--muted-dark);
      text-transform: uppercase;
      margin-bottom: 4px;
      display: block;
    }

    /* Button Tokens */
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--space-2);
      font-family: var(--font-ui);
      font-size: 0.875rem;
      font-weight: 600;
      padding: 9px 18px;
      border-radius: var(--radius-sm);
      cursor: pointer;
      text-decoration: none;
      transition: all 0.15s ease-in-out;
      border: 1px solid transparent;
      outline: none;
      user-select: none;
    }
    
    /* Primary Projector Amber Button */
    .btn-primary {
      background: var(--accent);
      color: #0E0B09;
      border-color: #FFAA33;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.5), 0 0 12px rgba(255, 159, 28, 0.22);
    }
    .btn-primary:hover, .btn-primary.is-hover {
      background: #FFAE38;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.6), 0 0 20px rgba(255, 159, 28, 0.45);
      transform: translateY(-1px);
    }
    .btn-primary:active, .btn-primary.is-active {
      background: #E6880C;
      transform: translateY(1px);
      box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.4);
    }
    .btn-primary:focus-visible, .btn-primary.is-focus {
      outline: 2px solid var(--accent);
      outline-offset: 3px;
    }
    .btn-primary:disabled, .btn-primary.is-disabled {
      opacity: 0.35;
      cursor: not-allowed;
      transform: none;
      box-shadow: none;
    }

    /* Secondary Velvet Button */
    .btn-secondary {
      background: var(--surface-2);
      color: var(--text);
      border-color: var(--border-brass);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
    }
    .btn-secondary:hover, .btn-secondary.is-hover {
      background: var(--surface-3);
      border-color: var(--border-brass-bright);
      color: #FFFFFF;
      transform: translateY(-1px);
    }
    .btn-secondary:active, .btn-secondary.is-active {
      background: #1F1813;
      box-shadow: var(--shadow-inset-velvet);
      transform: translateY(1px);
    }
    .btn-secondary:focus-visible, .btn-secondary.is-focus {
      outline: 2px solid var(--text);
      outline-offset: 2px;
    }
    .btn-secondary:disabled, .btn-secondary.is-disabled {
      opacity: 0.35;
      cursor: not-allowed;
      transform: none;
    }

    /* Marquee Red / Destructive */
    .btn-danger {
      background: rgba(214, 40, 57, 0.12);
      color: #FF5A6E;
      border-color: rgba(214, 40, 57, 0.4);
    }
    .btn-danger:hover, .btn-danger.is-hover {
      background: rgba(214, 40, 57, 0.25);
      border-color: var(--danger);
      box-shadow: 0 0 16px rgba(214, 40, 57, 0.35);
      color: #FFFFFF;
    }
    .btn-danger:active, .btn-danger.is-active {
      background: rgba(214, 40, 57, 0.4);
    }

    /* Ghost Understated */
    .btn-ghost {
      background: transparent;
      color: var(--muted);
      border-color: transparent;
    }
    .btn-ghost:hover, .btn-ghost.is-hover {
      color: var(--text);
      background: var(--surface-2);
    }

    /* Ticket Tear Button */
    .btn-ticket {
      font-family: var(--font-mono);
      font-size: 0.75rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      background: var(--surface-2);
      border: 1px dashed var(--accent);
      color: var(--accent);
      padding: 8px 14px;
      border-radius: var(--radius-sm);
    }
    .btn-ticket:hover {
      background: rgba(255, 159, 28, 0.1);
      box-shadow: 0 0 12px rgba(255, 159, 28, 0.25);
    }

    /* Reel Spinner in Loading Button */
    .reel-spinner {
      width: 16px;
      height: 16px;
      border: 2px solid rgba(14, 11, 9, 0.3);
      border-top-color: #0E0B09;
      border-radius: 50%;
      animation: reelSpin 0.7s infinite linear;
    }
    @keyframes reelSpin {
      to { transform: rotate(360deg); }
    }

    /* Form Controls */
    .input-group {
      margin-bottom: var(--space-4);
    }
    .input-label {
      display: block;
      font-size: 0.8125rem;
      font-weight: 500;
      color: var(--text);
      margin-bottom: 6px;
    }
    .input-field {
      width: 100%;
      background: var(--surface-2);
      border: 1px solid var(--border-brass);
      border-radius: var(--radius-sm);
      padding: 10px 14px;
      font-family: var(--font-ui);
      font-size: 0.875rem;
      color: var(--text);
      box-shadow: var(--shadow-inset-velvet);
      transition: all 0.2s ease;
      outline: none;
    }
    .input-field:focus, .input-field.is-focus {
      border-color: var(--accent);
      box-shadow: 0 0 12px rgba(255, 159, 28, 0.25), var(--shadow-inset-velvet);
    }
    .input-field.is-error {
      border-color: var(--danger);
      box-shadow: 0 0 12px rgba(214, 40, 57, 0.25), var(--shadow-inset-velvet);
    }
    .input-error-msg {
      font-size: 0.75rem;
      color: #FF5A6E;
      margin-top: 4px;
      display: flex;
      align-items: center;
      gap: 4px;
    }

    /* Box Office 6-Digit Room Code */
    .room-code-input-wrap {
      display: flex;
      gap: 8px;
    }
    .room-code-cell {
      width: 44px;
      height: 52px;
      background: var(--surface-2);
      border: 1px solid var(--border-brass);
      border-radius: var(--radius-sm);
      font-family: var(--font-mono);
      font-size: 1.25rem;
      font-weight: 700;
      color: var(--accent);
      text-align: center;
      outline: none;
      box-shadow: var(--shadow-inset-velvet);
      transition: all 0.2s;
    }
    .room-code-cell:focus {
      border-color: var(--accent);
      box-shadow: 0 0 14px rgba(255, 159, 28, 0.35);
    }

    /* Tactile Brass Toggle */
    .switch-label {
      display: flex;
      align-items: center;
      justify-content: space-between;
      cursor: pointer;
      user-select: none;
      padding: var(--space-2) 0;
    }
    .switch-text {
      font-size: 0.875rem;
      color: var(--text);
    }
    .switch-subtext {
      font-size: 0.75rem;
      color: var(--muted);
    }
    .brass-switch {
      width: 44px;
      height: 24px;
      background: var(--surface-3);
      border: 1px solid var(--border-brass);
      border-radius: var(--radius-pill);
      position: relative;
      transition: all 0.2s;
      flex-shrink: 0;
    }
    .brass-switch::after {
      content: "";
      position: absolute;
      top: 2px;
      left: 2px;
      width: 18px;
      height: 18px;
      background: var(--muted);
      border-radius: 50%;
      transition: all 0.2s;
    }
    .brass-switch.checked {
      background: rgba(255, 159, 28, 0.2);
      border-color: var(--accent);
    }
    .brass-switch.checked::after {
      left: 22px;
      background: var(--accent);
      box-shadow: 0 0 8px rgba(255, 159, 28, 0.8);
    }

    /* Badges & Indicators */
    .badge-wrap {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-3);
      align-items: center;
    }
    .badge-live {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(46, 196, 182, 0.12);
      border: 1px solid rgba(46, 196, 182, 0.35);
      color: var(--live);
      padding: 3px 10px;
      border-radius: var(--radius-pill);
      font-family: var(--font-mono);
      font-size: 0.75rem;
      font-weight: 600;
    }
    .badge-live-beacon {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--live);
      box-shadow: var(--shadow-cathode);
      animation: cathodeBlink 2s infinite ease-in-out;
    }
    @keyframes cathodeBlink {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.45; transform: scale(0.85); }
    }
    .badge-projectionist {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      background: rgba(255, 159, 28, 0.12);
      border: 1px solid var(--border-brass-bright);
      color: var(--accent);
      padding: 3px 10px;
      border-radius: var(--radius-sm);
      font-family: var(--font-mono);
      font-size: 0.6875rem;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .badge-vault {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      background: var(--surface-2);
      border: 1px solid var(--border-brass);
      color: var(--muted);
      padding: 3px 10px;
      border-radius: var(--radius-sm);
      font-family: var(--font-mono);
      font-size: 0.75rem;
    }

    /* Ticket Stub Real Card */
    .ticket-showcase {
      display: grid;
      grid-template-columns: 2fr 1fr;
      gap: var(--space-6);
    }
    @media (max-width: 860px) {
      .ticket-showcase { grid-template-columns: 1fr; }
    }
    .ticket-card {
      background: var(--surface);
      border: 1px solid var(--border-brass);
      border-radius: var(--radius-ticket);
      box-shadow: var(--shadow-surface);
      position: relative;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .ticket-main {
      padding: var(--space-6);
    }
    .ticket-foyer-id {
      font-family: var(--font-mono);
      font-size: 0.6875rem;
      color: var(--accent);
      letter-spacing: 0.1em;
      text-transform: uppercase;
      margin-bottom: var(--space-2);
      display: flex;
      justify-content: space-between;
    }
    .ticket-movie-title {
      font-family: var(--font-display);
      font-size: 1.75rem;
      font-weight: 700;
      letter-spacing: -0.03em;
      color: var(--text);
      margin-bottom: var(--space-3);
    }
    .ticket-metadata-row {
      display: flex;
      gap: var(--space-6);
      margin-bottom: var(--space-4);
    }
    .ticket-meta-item {
      font-size: 0.75rem;
    }
    .ticket-meta-label {
      color: var(--muted-dark);
      text-transform: uppercase;
      font-family: var(--font-mono);
      font-size: 0.6875rem;
    }
    .ticket-meta-val {
      color: var(--text);
      font-weight: 600;
      margin-top: 2px;
    }
    /* Perforation Seam */
    .ticket-perforation {
      position: relative;
      border-top: 1px dashed var(--border-brass);
      margin: 0;
    }
    .ticket-perforation::before,
    .ticket-perforation::after {
      content: "";
      position: absolute;
      top: -10px;
      width: 20px;
      height: 20px;
      background-color: var(--bg);
      border-radius: 50%;
      border: 1px solid var(--border-brass);
      z-index: 2;
    }
    .ticket-perforation::before {
      left: -11px;
    }
    .ticket-perforation::after {
      right: -11px;
    }
    .ticket-stub-footer {
      background: var(--surface-2);
      padding: var(--space-4) var(--space-6);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .barcode-lines {
      display: flex;
      gap: 2px;
      height: 32px;
      align-items: stretch;
    }
    .barcode-line {
      width: 2px;
      background: var(--muted);
    }
    .barcode-line.thick { width: 4px; }
    .barcode-line.gap { background: transparent; width: 3px; }

    /* Media Player Transport Deck */
    .player-deck-card {
      background: var(--surface);
      border: 1px solid var(--border-brass);
      border-radius: var(--radius-sm);
      padding: var(--space-6);
      box-shadow: var(--shadow-surface);
    }
    .timeline-bar-wrap {
      width: 100%;
      height: 6px;
      background: var(--surface-3);
      border-radius: 3px;
      position: relative;
      cursor: pointer;
      margin-bottom: var(--space-4);
    }
    .timeline-progress {
      width: 48%;
      height: 100%;
      background: var(--accent);
      border-radius: 3px;
      box-shadow: 0 0 10px rgba(255, 159, 28, 0.5);
    }
    .timeline-thumb {
      position: absolute;
      left: 48%;
      top: -5px;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: #FFFFFF;
      border: 3px solid var(--accent);
      box-shadow: 0 0 8px rgba(255, 159, 28, 0.7);
      transform: translateX(-50%);
    }
    .deck-controls {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .deck-buttons {
      display: flex;
      align-items: center;
      gap: var(--space-3);
    }
    .deck-btn {
      background: var(--surface-2);
      border: 1px solid var(--border-brass);
      color: var(--text);
      width: 38px;
      height: 38px;
      border-radius: var(--radius-sm);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.2s;
    }
    .deck-btn:hover {
      border-color: var(--accent);
      color: var(--accent);
    }
    .deck-btn.primary-play {
      background: var(--accent);
      color: #0E0B09;
      border-color: #FFAA33;
      width: 44px;
      height: 44px;
    }
    .deck-btn.primary-play:hover {
      box-shadow: 0 0 16px rgba(255, 159, 28, 0.5);
    }
    .timecode-display {
      font-family: var(--font-mono);
      font-size: 0.875rem;
      color: var(--text);
      font-variant-numeric: tabular-nums;
    }
    .timecode-total {
      color: var(--muted-dark);
    }

    /* Personality States Grid */
    .personality-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
      gap: var(--space-6);
    }
    .state-card {
      background: var(--surface);
      border: 1px solid var(--border-brass);
      border-radius: var(--radius-sm);
      padding: var(--space-8) var(--space-6);
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      box-shadow: var(--shadow-surface);
    }
    .state-icon-circle {
      width: 64px;
      height: 64px;
      border-radius: 50%;
      background: var(--surface-2);
      border: 1px solid var(--border-brass);
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: var(--space-4);
    }
    .state-card-title {
      font-family: var(--font-display);
      font-size: 1.25rem;
      font-weight: 700;
      color: var(--text);
      margin-bottom: var(--space-2);
    }
    .state-card-desc {
      font-size: 0.875rem;
      color: var(--muted);
      line-height: 1.5;
      max-width: 280px;
      margin-bottom: var(--space-6);
    }

    /* 35mm Sprocket Loading Graphic */
    .film-sprocket-loader {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: var(--space-4);
    }
    .sprocket-cell {
      width: 14px;
      height: 18px;
      border: 2px solid var(--border-brass-bright);
      border-radius: 2px;
      animation: sprocketPulse 1.2s infinite ease-in-out;
    }
    .sprocket-cell:nth-child(2) { animation-delay: 0.2s; }
    .sprocket-cell:nth-child(3) { animation-delay: 0.4s; }
    .sprocket-cell:nth-child(4) { animation-delay: 0.6s; }
    @keyframes sprocketPulse {
      0%, 100% { border-color: var(--border-brass); background: transparent; }
      50% { border-color: var(--accent); background: rgba(255, 159, 28, 0.3); }
    }

    /* Velvet Skeleton Shimmer */
    .skeleton-box {
      background: linear-gradient(90deg, #1A1512 0%, #2B221B 50%, #1A1512 100%);
      background-size: 200% 100%;
      animation: skeletonShimmer 2s infinite ease-in-out;
      border-radius: var(--radius-sm);
    }
    @keyframes skeletonShimmer {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }

    /* Toast Notification */
    #toast-msg {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: var(--surface-2);
      border: 1px solid var(--border-brass-bright);
      color: var(--text);
      padding: 10px 18px;
      border-radius: var(--radius-sm);
      font-family: var(--font-mono);
      font-size: 0.8125rem;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.8);
      z-index: 10000;
      opacity: 0;
      transform: translateY(10px);
      transition: all 0.25s ease;
      pointer-events: none;
    }
    #toast-msg.show {
      opacity: 1;
      transform: translateY(0);
    }
  </style>
</head>
<body>

  <!-- Atmospheric Layers -->
  <div id="film-grain-layer"></div>
  <div id="projector-beam-layer"></div>

  <!-- Marquee Bulb Top Banner -->
  <div class="marquee-bar">
    <div class="marquee-bulbs">
      <div class="marquee-bulb"></div>
      <div class="marquee-bulb"></div>
      <div class="marquee-bulb"></div>
      <div class="marquee-bulb"></div>
      <span class="marquee-title">The Private Cinema • Design Atelier</span>
    </div>

    <div class="marquee-controls">
      <div class="budget-badge" title="Design rule: Accent colors must occupy under 10% of any screen surface">
        <span>Accent Budget</span>
        <div class="budget-gauge"><div class="budget-gauge-fill"></div></div>
        <span style="color: var(--accent); font-weight: 700;">8.5%</span>
      </div>

      <button id="toggle-grain-btn" class="pill-toggle active" title="Toggle 35mm film grain overlay">
        <span class="dot"></span>
        <span>Film Grain</span>
      </button>

      <button id="toggle-beam-btn" class="pill-toggle active" title="Toggle overhead projector light beam">
        <span class="dot"></span>
        <span>Projector Beam</span>
      </button>
    </div>
  </div>

  <div class="container">

    <!-- Header Section -->
    <header class="hero-header">
      <div class="foyer-eyebrow">
        <span class="ticket-mark">SEC A • ADMIT ONE</span>
        <span>Watch Party Design System & Specification</span>
      </div>
      <h1 class="hero-title">The Private Cinema</h1>
      <p class="hero-subtitle">
        A warm, dark, tactile movie-theatre lobby: projector light, deep velvet, incandescent marquee bulbs, 35mm film grain, and ticket stubs. Built to feel like an authentic place, not an interchangeable SaaS dashboard.
      </p>
    </header>

    <!-- SECTION 1: COLOR TOKENS & ACCENT BUDGET -->
    <section class="section-wrap" id="colors">
      <div class="section-header">
        <div>
          <div class="section-num">01 / PALETTE</div>
          <h2 class="section-title">Colour Tokens (Dark Theme Only)</h2>
          <p class="section-desc">Strict &lt;10% accent rule. Zero purple-to-blue gradients. Click any card to copy token.</p>
        </div>
      </div>

      <div class="swatches-grid">
        <!-- Warm Black -->
        <div class="swatch-card" onclick="copyToken('--bg', '#0E0B09')">
          <div class="swatch-color-box has-border" style="background: #0E0B09;"></div>
          <div class="swatch-info">
            <div class="swatch-name"><span>Warm Black</span></div>
            <div class="swatch-role">Cinema darkness & void</div>
            <div class="swatch-meta"><span>--bg</span><span>#0E0B09</span></div>
          </div>
        </div>

        <!-- Primary Velvet Surface -->
        <div class="swatch-card" onclick="copyToken('--surface', '#1A1512')">
          <div class="swatch-color-box" style="background: #1A1512;"></div>
          <div class="swatch-info">
            <div class="swatch-name"><span>Velvet Surface</span></div>
            <div class="swatch-role">Panels, cards & foyer</div>
            <div class="swatch-meta"><span>--surface</span><span>#1A1512</span></div>
          </div>
        </div>

        <!-- Surface 2 -->
        <div class="swatch-card" onclick="copyToken('--surface-2', '#261E19')">
          <div class="swatch-color-box" style="background: #261E19;"></div>
          <div class="swatch-info">
            <div class="swatch-name"><span>Surface 2</span></div>
            <div class="swatch-role">Elevated stubs, faders</div>
            <div class="swatch-meta"><span>--surface-2</span><span>#261E19</span></div>
          </div>
        </div>

        <!-- Surface 3 -->
        <div class="swatch-card" onclick="copyToken('--surface-3', '#362B24')">
          <div class="swatch-color-box" style="background: #362B24;"></div>
          <div class="swatch-info">
            <div class="swatch-name"><span>Surface 3</span></div>
            <div class="swatch-role">Hover fills & active trim</div>
            <div class="swatch-meta"><span>--surface-3</span><span>#362B24</span></div>
          </div>
        </div>

        <!-- Cream Text -->
        <div class="swatch-card" onclick="copyToken('--text', '#F3E9DC')">
          <div class="swatch-color-box" style="background: #F3E9DC;"></div>
          <div class="swatch-info">
            <div class="swatch-name" style="color: #0E0B09;"><span>Cream Text</span></div>
            <div class="swatch-role">Screen reflection text</div>
            <div class="swatch-meta"><span>--text</span><span>#F3E9DC</span></div>
          </div>
        </div>

        <!-- Muted Oyster -->
        <div class="swatch-card" onclick="copyToken('--muted', '#A89B8C')">
          <div class="swatch-color-box" style="background: #A89B8C;"></div>
          <div class="swatch-info">
            <div class="swatch-name" style="color: #0E0B09;"><span>Muted Oyster</span></div>
            <div class="swatch-role">Subheads, metadata</div>
            <div class="swatch-meta"><span>--muted</span><span>#A89B8C</span></div>
          </div>
        </div>

        <!-- Projector Amber -->
        <div class="swatch-card" onclick="copyToken('--accent', '#FF9F1C')">
          <div class="swatch-color-box" style="background: #FF9F1C; box-shadow: 0 0 20px rgba(255, 159, 28, 0.4);"></div>
          <div class="swatch-info">
            <div class="swatch-name" style="color: #FF9F1C;"><span>Projector Amber</span></div>
            <div class="swatch-role">Primary accent (&lt;10%)</div>
            <div class="swatch-meta"><span>--accent</span><span>#FF9F1C</span></div>
          </div>
        </div>

        <!-- Marquee Red -->
        <div class="swatch-card" onclick="copyToken('--accent-2', '#E4572E')">
          <div class="swatch-color-box" style="background: #E4572E; box-shadow: 0 0 20px rgba(228, 87, 46, 0.4);"></div>
          <div class="swatch-info">
            <div class="swatch-name" style="color: #E4572E;"><span>Marquee Red</span></div>
            <div class="swatch-role">Alert, recording, beacon</div>
            <div class="swatch-meta"><span>--accent-2</span><span>#E4572E</span></div>
          </div>
        </div>

        <!-- Live Presence Teal -->
        <div class="swatch-card" onclick="copyToken('--live', '#2EC4B6')">
          <div class="swatch-color-box" style="background: #2EC4B6; box-shadow: 0 0 20px rgba(46, 196, 182, 0.4);"></div>
          <div class="swatch-info">
            <div class="swatch-name" style="color: #2EC4B6;"><span>Cathode Live</span></div>
            <div class="swatch-role">Online presence & sync</div>
            <div class="swatch-meta"><span>--live</span><span>#2EC4B6</span></div>
          </div>
        </div>

        <!-- Danger Warning -->
        <div class="swatch-card" onclick="copyToken('--danger', '#D62839')">
          <div class="swatch-color-box" style="background: #D62839;"></div>
          <div class="swatch-info">
            <div class="swatch-name" style="color: #D62839;"><span>Ejection Danger</span></div>
            <div class="swatch-role">Torn ticket / fatal error</div>
            <div class="swatch-meta"><span>--danger</span><span>#D62839</span></div>
          </div>
        </div>
      </div>
    </section>

    <!-- SECTION 2: TYPOGRAPHY SYSTEM -->
    <section class="section-wrap" id="typography">
      <div class="section-header">
        <div>
          <div class="section-num">02 / TYPOGRAPHY</div>
          <h2 class="section-title">Characterful Cinema Typography</h2>
          <p class="section-desc">Fraunces display with tight tracking, Instrument Sans / DM Sans UI, JetBrains Mono codes.</p>
        </div>
      </div>

      <div class="type-specimen-grid">
        <div class="specimen-card">
          <span class="specimen-tag">Display Heading • Fraunces 700 (Tight Tracking -0.035em)</span>
          <div class="specimen-display">Balcony Suite 4: Now Showing 35mm Gate</div>
          <p class="specimen-body">
            Headings feature generous serifs, warm curves, and architectural presence. Avoid generic grotesque fonts for hero copy.
          </p>
          <div class="specimen-mono">h1 { font-family: 'Fraunces', serif; letter-spacing: -0.035em; }</div>
        </div>

        <div class="specimen-card">
          <span class="specimen-tag">UI & Dialogue • Instrument Sans / DM Sans</span>
          <div class="specimen-subhead">Projectionist Controls & Auditorium Roster</div>
          <p class="specimen-body">
            Clean humanist geometry provides instant scanning under low-light screening conditions. High legibility without cold neutrality.
          </p>
          <div class="specimen-mono">body { font-family: 'DM Sans', 'Instrument Sans', sans-serif; }</div>
        </div>
      </div>

      <!-- Chat Line-Height Specimen -->
      <div class="chat-comparison">
        <span class="specimen-tag">Chat Typography • Generous Line-Height (1.625)</span>
        <div class="chat-bubble">
          <div class="chat-header">
            <span class="chat-author">
              <span class="badge-projectionist">PROJECTIONIST</span>
              <span>Elena Rostova</span>
            </span>
            <span class="chat-time">01:42:18.04</span>
          </div>
          <div class="chat-body-generous">
            Notice how the generous line-height of 1.625 keeps rapid-fire watch party banter readable in the dark auditorium. When participants react during intense scenes, the text never crowds or creates visual fatigue.
          </div>
        </div>
      </div>
    </section>

    <!-- SECTION 3: CUSTOM CINEMA ICONOGRAPHY (NO EMOJI) -->
    <section class="section-wrap" id="icons">
      <div class="section-header">
        <div>
          <div class="section-num">03 / ICONOGRAPHY</div>
          <h2 class="section-title">Tuned Cinema Icon Set</h2>
          <p class="section-desc">Custom 1.6px stroke SVGs. Strictly zero emoji used as functional UI icons.</p>
        </div>
      </div>

      <div class="icons-matrix">
        <div class="icon-box">
          <svg viewBox="0 0 24 24"><path d="M4 8h12v12H4z"/><path d="M16 11l4-3v8l-4-3"/><circle cx="8" cy="14" r="2"/></svg>
          <span class="icon-label">Projector</span>
        </div>
        <div class="icon-box">
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><circle cx="12" cy="6" r="1"/><circle cx="12" cy="18" r="1"/><circle cx="6" cy="12" r="1"/><circle cx="18" cy="12" r="1"/></svg>
          <span class="icon-label">35mm Reel</span>
        </div>
        <div class="icon-box">
          <svg viewBox="0 0 24 24"><path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2z"/><path d="M13 5v14" stroke-dasharray="2 2"/></svg>
          <span class="icon-label">Ticket Stub</span>
        </div>
        <div class="icon-box">
          <svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          <span class="icon-label">Play</span>
        </div>
        <div class="icon-box">
          <svg viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
          <span class="icon-label">Pause</span>
        </div>
        <div class="icon-box">
          <svg viewBox="0 0 24 24"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>
          <span class="icon-label">Volume</span>
        </div>
        <div class="icon-box">
          <svg viewBox="0 0 24 24"><path d="M3 8V5a2 2 0 0 1 2-2h3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M21 16v3a2 2 0 0 1-2 2h-3"/></svg>
          <span class="icon-label">Curtain Max</span>
        </div>
        <div class="icon-box">
          <svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          <span class="icon-label">Audience</span>
        </div>
        <div class="icon-box">
          <svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          <span class="icon-label">E2EE Vault</span>
        </div>
        <div class="icon-box">
          <svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <span class="icon-label">Chat</span>
        </div>
        <div class="icon-box">
          <svg viewBox="0 0 24 24"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
          <span class="icon-label">Splice Film</span>
        </div>
        <div class="icon-box">
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <span class="icon-label">Jam Alert</span>
        </div>
      </div>
    </section>

    <!-- SECTION 4: BUTTONS & INTERACTIVE STATES -->
    <section class="section-wrap" id="buttons">
      <div class="section-header">
        <div>
          <div class="section-num">04 / ATELIER</div>
          <h2 class="section-title">Buttons & Interactive Triggers</h2>
          <p class="section-desc">Every variant displayed in every state: Default, Hover, Active, Focus, Disabled, Loading.</p>
        </div>
      </div>

      <div class="atelier-grid">
        <!-- Primary Amber -->
        <div class="atelier-card">
          <div class="atelier-card-title">
            <span>Primary (Projector Amber)</span>
            <span class="badge-projectionist">MAIN CTA</span>
          </div>

          <span class="state-label">Default State</span>
          <div class="btn-row">
            <button class="btn btn-primary">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              <span>Illuminate Screen</span>
            </button>
          </div>

          <span class="state-label">Simulated States</span>
          <div class="btn-row">
            <button class="btn btn-primary is-hover">Hover</button>
            <button class="btn btn-primary is-active">Active</button>
            <button class="btn btn-primary is-focus">Focus</button>
            <button class="btn btn-primary" disabled>Disabled</button>
            <button class="btn btn-primary">
              <div class="reel-spinner"></div>
              <span>Threading...</span>
            </button>
          </div>
        </div>

        <!-- Secondary Velvet -->
        <div class="atelier-card">
          <div class="atelier-card-title">
            <span>Secondary (Velvet Foyer)</span>
            <span class="badge-vault">SURFACE 2</span>
          </div>

          <span class="state-label">Default State</span>
          <div class="btn-row">
            <button class="btn btn-secondary">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2z"/></svg>
              <span>View Balcony Pass</span>
            </button>
          </div>

          <span class="state-label">Simulated States</span>
          <div class="btn-row">
            <button class="btn btn-secondary is-hover">Hover</button>
            <button class="btn btn-secondary is-active">Active</button>
            <button class="btn btn-secondary is-focus">Focus</button>
            <button class="btn btn-secondary" disabled>Disabled</button>
            <button class="btn btn-secondary">
              <div class="reel-spinner" style="border-top-color: var(--text);"></div>
              <span>Syncing</span>
            </button>
          </div>
        </div>

        <!-- Marquee Red / Destructive -->
        <div class="atelier-card">
          <div class="atelier-card-title">
            <span>Marquee Red / Destructive</span>
            <span style="color: var(--danger); font-family: var(--font-mono); font-size: 0.75rem;">EJECTION</span>
          </div>

          <span class="state-label">Default State</span>
          <div class="btn-row">
            <button class="btn btn-danger">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>
              <span>Extinguish Session</span>
            </button>
          </div>

          <span class="state-label">Simulated States</span>
          <div class="btn-row">
            <button class="btn btn-danger is-hover">Hover</button>
            <button class="btn btn-danger is-active">Active</button>
            <button class="btn btn-danger" disabled>Disabled</button>
          </div>
        </div>

        <!-- Ticket Stub Tear Button -->
        <div class="atelier-card">
          <div class="atelier-card-title">
            <span>Ticket Stub Action & Ghost</span>
            <span class="badge-projectionist">TACTILE</span>
          </div>

          <span class="state-label">Interactive Ticket Action</span>
          <div class="btn-row">
            <button id="tear-demo-btn" class="btn btn-ticket" onclick="handleTearStub()">
              <span>✂ Tear &amp; Join Room</span>
            </button>
            <button class="btn btn-ghost">Dismiss Foyer</button>
          </div>
        </div>
      </div>
    </section>

    <!-- SECTION 5: FORM CONTROLS & ROOM CODES -->
    <section class="section-wrap" id="forms">
      <div class="section-header">
        <div>
          <div class="section-num">05 / INPUTS</div>
          <h2 class="section-title">Form Controls & Box Office Inputs</h2>
          <p class="section-desc">Velvet inset depressions, segmented 6-digit box office punch card, brass toggles.</p>
        </div>
      </div>

      <div class="atelier-grid">
        <div class="atelier-card">
          <div class="atelier-card-title"><span>Standard Velvet Input</span></div>

          <div class="input-group">
            <label class="input-label">Stream URL or 35mm Magnet Link</label>
            <input type="text" class="input-field" placeholder="https://cinema.watchparty.live/stream.m3u8" value="https://stream.criterion.org/stalker-1979-4k.mpd">
          </div>

          <div class="input-group">
            <label class="input-label">Simulated Error State</label>
            <input type="text" class="input-field is-error" value="http://insecure-feed.invalid/broken">
            <div class="input-error-msg">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              <span>Invalid codec: Stream audio track is unparseable</span>
            </div>
          </div>
        </div>

        <div class="atelier-card">
          <div class="atelier-card-title"><span>Box Office 6-Digit Code Input</span></div>
          <p style="font-size: 0.8125rem; color: var(--muted); margin-bottom: var(--space-4);">Segmented ticket punch-code style with monospaced tracking:</p>

          <div class="room-code-input-wrap">
            <input type="text" maxlength="1" class="room-code-cell" value="8">
            <input type="text" maxlength="1" class="room-code-cell" value="4">
            <input type="text" maxlength="1" class="room-code-cell" value="1">
            <input type="text" maxlength="1" class="room-code-cell" value="9">
            <input type="text" maxlength="1" class="room-code-cell" value="0">
            <input type="text" maxlength="1" class="room-code-cell" value="3">
          </div>

          <div style="margin-top: var(--space-6);">
            <div class="switch-label" onclick="toggleSwitch(this)">
              <div>
                <div class="switch-text">Auditorium Whispers (Spatial Chat)</div>
                <div class="switch-subtext">Enable directional audio based on seat placement</div>
              </div>
              <div class="brass-switch checked"></div>
            </div>

            <div class="switch-label" onclick="toggleSwitch(this)">
              <div>
                <div class="switch-text">Projector Auto-Shutter</div>
                <div class="switch-subtext">Pause reel if any participant drops below 500ms drift</div>
              </div>
              <div class="brass-switch"></div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- SECTION 6: TICKET STUB CARDS (ASYMMETRIC) -->
    <section class="section-wrap" id="tickets">
      <div class="section-header">
        <div>
          <div class="section-num">06 / PHYSICALITY</div>
          <h2 class="section-title">Perforated Ticket Stub Cards</h2>
          <p class="section-desc">Authentic cinema admission pass with circular punched notches and tear seam.</p>
        </div>
      </div>

      <div class="ticket-showcase">
        <!-- Authentic Ticket Stub -->
        <div class="ticket-card" id="demo-ticket-card">
          <div class="ticket-main">
            <div class="ticket-foyer-id">
              <span>FOYER ADMISSION PASS</span>
              <span>NO. 0841903</span>
            </div>
            <div class="ticket-movie-title">2001: A Space Odyssey (Roadshow Cut)</div>
            
            <div class="ticket-metadata-row">
              <div class="ticket-meta-item">
                <div class="ticket-meta-label">Auditorium</div>
                <div class="ticket-meta-val">Balcony Suite 4</div>
              </div>
              <div class="ticket-meta-item">
                <div class="ticket-meta-label">Format</div>
                <div class="ticket-meta-val">70mm Super Panavision</div>
              </div>
              <div class="ticket-meta-item">
                <div class="ticket-meta-label">Sync Drift</div>
                <div class="ticket-meta-val" style="color: var(--live);">0.12ms (Master)</div>
              </div>
              <div class="ticket-meta-item">
                <div class="ticket-meta-label">Security</div>
                <div class="ticket-meta-val">E2EE Sealed</div>
              </div>
            </div>
          </div>

          <div class="ticket-perforation"></div>

          <div class="ticket-stub-footer">
            <div style="display: flex; align-items: center; gap: var(--space-4);">
              <div class="barcode-lines">
                <div class="barcode-line"></div>
                <div class="barcode-line thick"></div>
                <div class="barcode-line gap"></div>
                <div class="barcode-line"></div>
                <div class="barcode-line thick"></div>
                <div class="barcode-line"></div>
                <div class="barcode-line gap"></div>
                <div class="barcode-line thick"></div>
                <div class="barcode-line"></div>
              </div>
              <span style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--muted-dark);">8419-0394-WP</span>
            </div>

            <button class="btn btn-primary" onclick="handleTearStub()">
              <span>Punch Stub</span>
            </button>
          </div>
        </div>

        <!-- Badges & Status Pills -->
        <div class="atelier-card">
          <div class="atelier-card-title"><span>Presence &amp; Security Badges</span></div>
          <div class="badge-wrap">
            <div class="badge-live">
              <div class="badge-live-beacon"></div>
              <span>ONLINE • 14 SEATS</span>
            </div>

            <div class="badge-projectionist">
              <span>PROJECTIONIST (HOST)</span>
            </div>

            <div class="badge-vault">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              <span>AES-GCM-256</span>
            </div>

            <div class="badge-vault" style="color: var(--accent);">
              <span>35mm HDR • 60 FPS</span>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- SECTION 7: MEDIA TRANSPORT DECK -->
    <section class="section-wrap" id="deck">
      <div class="section-header">
        <div>
          <div class="section-num">07 / PLAYER DECK</div>
          <h2 class="section-title">Tactile Cinema Transport Deck</h2>
          <p class="section-desc">Amber timeline, precision clock display, vintage playback switches.</p>
        </div>
      </div>

      <div class="player-deck-card">
        <div class="timeline-bar-wrap" onclick="seekClick(event)">
          <div class="timeline-progress" id="demo-progress"></div>
          <div class="timeline-thumb" id="demo-thumb"></div>
        </div>

        <div class="deck-controls">
          <div class="deck-buttons">
            <button class="deck-btn" title="Rewind 10s">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 19 2 12 11 5 11 19"/><polygon points="22 19 13 12 22 5 22 19"/></svg>
            </button>
            <button class="deck-btn primary-play" id="play-btn" onclick="togglePlayState()" title="Play / Pause">
              <svg id="play-icon" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            </button>
            <button class="deck-btn" title="Fast Forward 10s">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 19 22 12 13 5 13 19"/><polygon points="2 19 11 12 2 5 2 19"/></svg>
            </button>
            <div class="timecode-display">
              <span id="timecode-current" style="color: var(--accent);">01:14:28.08</span>
              <span class="timecode-total"> / 02:29:00.00</span>
            </div>
          </div>

          <div style="display: flex; align-items: center; gap: var(--space-4);">
            <div class="badge-live" style="background: transparent; border-color: var(--border-brass);">
              <div class="badge-live-beacon"></div>
              <span>Clock Locked (0.1ms)</span>
            </div>
            <button class="deck-btn" title="Theater Mode Fullscreen">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- SECTION 8: REAL PERSONALITY STATES -->
    <section class="section-wrap" id="states">
      <div class="section-header">
        <div>
          <div class="section-num">08 / STATES</div>
          <h2 class="section-title">Personality-Driven States (No Generic Placeholders)</h2>
          <p class="section-desc">Every empty, loading, or error state is grounded in cinema terminology.</p>
        </div>
      </div>

      <div class="personality-grid">
        <!-- Empty State -->
        <div class="state-card">
          <div class="state-icon-circle">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="1.8"><path d="M4 8h12v12H4z"/><path d="M16 11l4-3v8l-4-3"/><line x1="8" y1="2" x2="8" y2="8"/><line x1="12" y1="2" x2="12" y2="8"/></svg>
          </div>
          <h3 class="state-card-title">The Projector is Cold</h3>
          <p class="state-card-desc">
            Thread the first 35mm reel to illuminate the auditorium. Paste a video stream or select from your local library.
          </p>
          <button class="btn btn-primary" onclick="showToast('Loading reel to gate...')">
            <span>Thread First Reel</span>
          </button>
        </div>

        <!-- Loading State -->
        <div class="state-card">
          <div class="film-sprocket-loader">
            <div class="sprocket-cell"></div>
            <div class="sprocket-cell"></div>
            <div class="sprocket-cell"></div>
            <div class="sprocket-cell"></div>
          </div>
          <h3 class="state-card-title">Threading 35mm Gate</h3>
          <p class="state-card-desc">
            Aligning participant clocks to precision master NTP and verifying audio sync buffers across the room...
          </p>
          <div style="width: 100%; max-width: 200px; height: 12px;" class="skeleton-box"></div>
        </div>

        <!-- Error State -->
        <div class="state-card" style="border-color: rgba(214, 40, 57, 0.4);">
          <div class="state-icon-circle" style="background: rgba(214, 40, 57, 0.12); border-color: rgba(214, 40, 57, 0.4);">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          </div>
          <h3 class="state-card-title" style="color: #FF5A6E;">Intermission: Film Jammed</h3>
          <p class="state-card-desc">
            The projectionist is untangling the sprockets. Playback stream paused at 01:14:28 to preserve group sync.
          </p>
          <button class="btn btn-danger" onclick="showToast('Film spliced! Resuming synchronized gate.')">
            <span>Splice Film &amp; Resume</span>
          </button>
        </div>
      </div>
    </section>

    <!-- Footer -->
    <footer style="padding: var(--space-12) 0; border-top: 1px solid var(--border-brass); display: flex; justify-content: space-between; align-items: center; color: var(--muted); font-size: 0.8125rem;">
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-family: var(--font-display); font-weight: 700; color: var(--text);">WATCH PARTY</span>
        <span>• Private Cinema Design System</span>
      </div>
      <div style="font-family: var(--font-mono); font-size: 0.75rem;">
        DESIGN.md • tokens.css • tailwind.config.ts
      </div>
    </footer>

  </div>

  <!-- Toast Notification -->
  <div id="toast-msg"></div>

  <script>
    // Copy token utility
    function copyToken(tokenName, hexVal) {
      navigator.clipboard.writeText(tokenName + ': ' + hexVal);
      showToast('Copied: ' + tokenName + ' (' + hexVal + ')');
    }

    // Toast notification
    function showToast(text) {
      const toast = document.getElementById('toast-msg');
      toast.textContent = text;
      toast.classList.add('show');
      setTimeout(() => {
        toast.classList.remove('show');
      }, 2400);
    }

    // Film Grain toggle
    const grainBtn = document.getElementById('toggle-grain-btn');
    const grainLayer = document.getElementById('film-grain-layer');
    let grainActive = true;
    grainBtn.addEventListener('click', () => {
      grainActive = !grainActive;
      grainLayer.style.opacity = grainActive ? '0.85' : '0';
      grainBtn.classList.toggle('active', grainActive);
      showToast(grainActive ? '35mm Film Grain: Enabled' : '35mm Film Grain: Disabled');
    });

    // Projector Beam toggle
    const beamBtn = document.getElementById('toggle-beam-btn');
    const beamLayer = document.getElementById('projector-beam-layer');
    let beamActive = true;
    beamBtn.addEventListener('click', () => {
      beamActive = !beamActive;
      beamLayer.style.opacity = beamActive ? '1' : '0';
      beamBtn.classList.toggle('active', beamActive);
      showToast(beamActive ? 'Projector Beam: Illuminating' : 'Projector Beam: Shuttered');
    });

    // Toggle brass switch
    function toggleSwitch(element) {
      const switchHandle = element.querySelector('.brass-switch');
      switchHandle.classList.toggle('checked');
      showToast(switchHandle.classList.contains('checked') ? 'Setting Engaged' : 'Setting Disengaged');
    }

    // Tear stub action
    function handleTearStub() {
      const ticket = document.getElementById('demo-ticket-card');
      ticket.style.transform = 'scale(0.98)';
      ticket.style.borderColor = 'var(--accent)';
      setTimeout(() => {
        ticket.style.transform = 'none';
        showToast('🎟 Ticket Punched! Admitted to Balcony Suite 4');
      }, 150);
    }

    // Player Deck Play/Pause toggle
    let isPlaying = false;
    function togglePlayState() {
      isPlaying = !isPlaying;
      const playIcon = document.getElementById('play-icon');
      if (isPlaying) {
        playIcon.innerHTML = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';
        showToast('Projector running: Synchronized playback');
      } else {
        playIcon.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"/>';
        showToast('Projector paused: Gate shutter closed');
      }
    }

    // Seek Click
    function seekClick(event) {
      const rect = event.currentTarget.getBoundingClientRect();
      const clickX = event.clientX - rect.left;
      const pct = Math.max(0, Math.min(100, (clickX / rect.width) * 100));
      document.getElementById('demo-progress').style.width = pct + '%';
      document.getElementById('demo-thumb').style.left = pct + '%';
      showToast('Scrubbed to ' + pct.toFixed(1) + '% of reel');
    }
  </script>
</body>
</html>`;
}
