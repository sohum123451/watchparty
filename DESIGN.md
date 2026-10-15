# The Private Cinema — Design System

> **Watch Party Design System & Aesthetic Foundation**  
> *"It should feel like a place, not a dashboard."*

---

## 1. Concept: The Private Cinema

Watch Party is not a software utility or generic SaaS dashboard. It is an intimate screening room entered through a warm, dimly lit theatre lobby. 

The atmosphere carries tactile weight:
- **Projector Light**: A warm amber beam cutting through dust motes in a dark room.
- **Velvet Surfaces**: Deep, light-absorbing textile tones that cushion the eyes during long film sessions.
- **Marquee Bulbs**: Incandescent tungsten points of light pulsing gently at the perimeter.
- **35mm Film Grain**: A subtle tactile noise overlay that gives the viewport cinematic texture.
- **Ticket Stubs & Box Office**: Asymmetric cards with perforated edges, notched punch-outs, and monospaced room codes.

---

## 2. Banned Patterns ("AI Slop" Prohibitions)

The following anti-patterns instantly signal lazy, generic output and are **strictly banned**:

| Banned Anti-Pattern | Why It Fails | What We Do Instead |
| :--- | :--- | :--- |
| **Generic Gradient Hero Text** | Cheap SaaS look (`#fff` to `#a5b4fc` fade). | Characterful typography with solid warm cream (`#F3E9DC`) and tight tracking. |
| **Glassmorphism on Everything** | Ubiquitous semi-transparent blur without substance. | Solid velvet surfaces (`#1A1512`, `#261E19`) with tactile brass hairline borders. |
| **Uniform `rounded-2xl` Card Grids** | Soulless tech-card grid homogenizing all content. | Asymmetric editorial layouts, ticket stubs with perforated seams, and physical proportioning. |
| **Emoji Used as Icons** | Inconsistent OS rendering, childish aesthetic. | Tuned custom SVG icons (1.5px warm stroke) with intentional cinema iconography. |
| **Centred "Welcome to X" + 3 Cards** | Textbook generic boilerplate layout. | Atmospheric marquee hero strip, real active screening status, and box office entry stubs. |
| **Stock Blobs & Floating Gradients** | Meaningless decorative noise. | Directional projector light cones (`radial-gradient`) and subtle 35mm film grain. |
| **Inter + Purple Defaults** | Default Tailwind / generic template feel. | **Fraunces** for headings, **Instrument Sans** / **DM Sans** for UI, **JetBrains Mono** for codes. |
| **Drop Shadows on Every Element** | Muddy visual hierarchy and floaty interface. | Controlled cast shadows (`--shadow-surface`), velvet depressions, and warm amber glows. |

---

## 3. Colour System (Dark Theme Only)

We do not provide a light theme. Cinemas are dark rooms.

```css
:root {
  --bg: #0E0B09;              /* Warm black (cinema darkness, void) */
  --surface: #1A1512;         /* Primary velvet surface (panels, cards) */
  --surface-2: #261E19;       /* Secondary surface (elevated faders, dialogs) */
  --surface-3: #362B24;       /* Tertiary surface (hover highlights, active states) */

  --text: #F3E9DC;            /* Warm cream (projector canvas reflection) */
  --muted: #A89B8C;           /* Muted oyster (captions, subheadings) */
  --muted-dark: #675C51;      /* Deep hairline muted (dividers, timestamps) */

  --accent: #FF9F1C;          /* Projector amber (spotlight focus, primary CTA) */
  --accent-2: #E4572E;        /* Marquee red (incandescent alert, recording beacon) */
  --live: #2EC4B6;            /* Live presence (phosphor cathode teal) */
  --danger: #D62839;          /* Ticket invalid / emergency ejection */

  --border-subtle: rgba(243, 233, 220, 0.08);
  --border-brass: rgba(243, 233, 220, 0.16);
  --border-brass-bright: rgba(255, 159, 28, 0.45);
}
```

### The 10% Accent Budget Rule
> [!IMPORTANT]
> **Accent colours (`--accent` projector amber and `--accent-2` marquee red) must occupy UNDER 10% of any screen surface.**
> They exist solely as targeted spotlights — active timeline head, focused button, live recording dot, or marquee header trim. The remaining 90%+ is warm darkness, velvet surfaces, and readable cream text.

---

## 4. Typography

### Typefaces
- **Headings & Display**: `Fraunces` (optical sizing, soft serif architectural presence) or `Bricolage Grotesque`.
- **Interface & Body**: `DM Sans` / `Instrument Sans` (modern humanist legibility, balanced geometry).
- **Timecodes & Identifiers**: `JetBrains Mono` (media playback markers, room join codes, cryptographic hashes).

### Type Scale & Rules
- **Display Tracking**: `--tracking-tight-display: -0.035em` on all `h1`-`h3`. Tight, intentional, editorial.
- **Chat Line-Height**: `--leading-chat: 1.625` (generous breathing room for long-running watch party conversations; never cram chat lines).
- **Timecode Legibility**: Always use `font-mono tabular-nums` for playback clocks (`01:24:58.12`) to eliminate jitter during playback.

---

## 5. Spacing & Grid System

Consistent 4px architectural grid:

| Token | Size | Common Application |
| :--- | :--- | :--- |
| `space-1` | 4px | Icon/text micro-gaps, badge internal paddings |
| `space-2` | 8px | Button inline gaps, list item vertical spacing |
| `space-3` | 12px | Input inner padding, avatar group overlap |
| `space-4` | 16px | Card content padding, toolbar spacing |
| `space-6` | 24px | Section gaps, modal padding |
| `space-8` | 32px | Foyer layout column gaps, drawer margins |
| `space-12` | 48px | Screen margin headers, major editorial divides |

---

## 6. Tactile Materials & Atmosphere

### 35mm Film Grain
Applied as a non-blocking SVG noise overlay (`feTurbulence`) at 3.5%–4% opacity across the viewport. This breaks the sterile digital flat-screen appearance and grounds the UI in physical film emulsion.

### Projector Beam Cone
Subtle radial gradient pinned to top-center of the cinema viewport (`radial-gradient(ellipse 75% 55% at 50% -20%, rgba(255,159,28,0.12), transparent 75%)`). Gives the sense of a physical light source overhead.

### Perforated Ticket Stub Cards
Physical ticket cards feature:
1. Brass border (`rgba(243, 233, 220, 0.16)`).
2. Dashed tear line across the stub.
3. Semicircular punch-notch cutouts on the card perimeter (`radial-gradient` masks).
4. Asymmetric split between pass metadata (left) and barcode / action trigger (right).

---

## 7. Component Anatomy & States

### Buttons
- **Primary ("Projector Amber")**: Fills with `--accent`, dark warm black text (`#0E0B09`), bold weight, slight amber perimeter glow. Hover tightens glow.
- **Secondary ("Velvet Foyer")**: Fills with `--surface-2`, brass hairline border, cream text. Active state depresses into surface (`--shadow-inset-velvet`).
- **Marquee / Destructive**: Fills with subtle dark red wash, border `--danger`, text `--danger`. Hover blooms incandescent marquee glow.
- **States**: `default`, `hover`, `active`, `focus-visible` (2px solid amber ring with 2px offset), `disabled` (35% opacity, grayscale wash), `loading` (spinning 35mm film reel sprockets).

### Form Controls & Room Codes
- **Inputs**: Velvet surface (`--surface`), inset velvet shadow, brass border. Focus glows with soft projector amber spotlight.
- **Box Office Code Input**: 6-segmented monospaced box office punch-card styling with wide letter spacing (`0.12em`).

### Indicators & Badges
- **Live Presence Beacon**: Phosphor teal dot with dual-stage pulsing glow (`@keyframes cathodeLivePulse`).
- **Marquee Strip**: Brass framed top banner with tungsten marquee bulbs pulsing alternately (`@keyframes marqueeBulbPulse`).
- **Host / Projectionist Badge**: Embossed brass tag (`border-brass-bright`, uppercase tracking).

---

## 8. Personality-Driven States (No Generic Placeholders)

Generic "No data available" screens destroy immersion. Every empty, loading, or error state must reflect the private cinema world:

### Empty States
1. **Empty Playlist**:  
   *Heading:* "The Projector is Cold"  
   *Subtext:* "Thread the first reel to illuminate the auditorium. Paste a video stream or select from your library."  
   *Action:* [ Thread 35mm Reel ]
2. **Empty Chat**:  
   *Heading:* "Auditorium Whispers"  
   *Subtext:* "The screening hasn't started yet. Grab your seat and drop a note to the room."
3. **Empty Friends List**:  
   *Heading:* "Empty Velvet Seats"  
   *Subtext:* "No guests in the lobby. Slip an invitation pass under a friend's door."

### Loading States
1. **Film Buffering / Room Joining**:  
   *Visual:* Rotating 35mm film reel sprockets with intermittent projector light flicker.  
   *Label:* "Threading 35mm Gate & Aligning Clocks..."
2. **Skeleton Screen**:  
   *Texture:* Warm charcoal-brass gradient shimmer across ticket stubs and playlist blocks (never plain gray CSS bars).

### Error States
1. **Connection Loss / Playback Stall**:  
   *Visual:* "Intermission — Film Jammed in Gate"  
   *Subtext:* "The projectionist is untangling the sprockets. Clocks paused at 00:42:19."  
   *Action:* [ Splice Film & Reconnect ]
2. **Room Forbidden / Invalid Ticket (403/404)**:  
   *Visual:* "Torn Ticket — Box Office Restricted"  
   *Subtext:* "This pass has expired or belongs to another private balcony suite."  
   *Action:* [ Return to Theatre Lobby ]

---

## 9. Code Reference & Showcase

- **CSS Tokens**: [`tokens.css`](file:///c:/Users/manga/OneDrive/Desktop/watchparty/tokens.css)
- **TypeScript Tokens**: [`packages/shared/src/design/tokens.ts`](file:///c:/Users/manga/OneDrive/Desktop/watchparty/packages/shared/src/design/tokens.ts)
- **Tailwind Config**: [`tailwind.config.js`](file:///c:/Users/manga/OneDrive/Desktop/watchparty/tailwind.config.js) & [`tailwind.config.ts`](file:///c:/Users/manga/OneDrive/Desktop/watchparty/tailwind.config.ts)
- **Interactive Component Showcase**: Run the server and visit `/design` to test every component and its states live.
