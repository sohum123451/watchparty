# PROGRESS

## Phase 0 – Audit ✅
Produced the full audit table of every interactive element and data source
on all four screens (Landing, Auth/TicketBoothAuth, Lobby, Room).
Hard-coded strings catalogued: Priya / Sam / Meera / Rohan, Grand Auditorium,
Big Buck Bunny, Elephants Dream, Sintel, Nosferatu, Tears of Steel,
A Trip to the Moon (lobby tonight-picks), plus static pick IDs and colours.

---

## Phase 1 – Connectivity & State Bugs ✅

### Done
- Created `packages/web/src/lib/useRoomSocket.ts`:
  - Full state machine: `idle → connecting → connected ↔ reconnecting → kicked | banned | left`
  - WS URL resolved 100% from `NEXT_PUBLIC_WS_URL` env var (never hardcoded)
  - Reconnect with exponential backoff + ±30% jitter, capped at 30 s
  - Logs WS URL and close code on every close event
  - Ban/kick errors are scoped to the current `roomCode`; cleared on leave
  - Reconnect loop only runs when a room is set and socket dropped unexpectedly
  - "Retry now" button in reconnecting banner
- Rewrote `TheatreAuditorium.tsx` to use `useRoomSocket`:
  - Removed all ad-hoc WebSocket code
  - Proper full-screen state screens: connecting, reconnecting banner,
    room-not-found, banned, kicked/room-full, left
  - NTP ping interval starts only when state is `connected`
  - No stale error banners on home screen (all state is local to the room component)
  - A fresh incognito window shows no banners
- Landing page (`page.tsx`):
  - Removed hardcoded room name `Grand Auditorium` from POST payload
  - Removed hardcoded `initialVideoId: 'big_buck_bunny'` from POST payload
  - Inline create-room error (was console.error only)
  - Inline join-code error when code field is empty
- Lobby page (`lobby/page.tsx`):
  - Removed ALL mock data: FRIENDS_LIST (Priya/Sam/Meera/Rohan) and TONIGHT_PICKS
  - Friends fetched live from `GET /api/friends` with loading / error / empty state
  - Catalogue fetched live from `GET /api/catalogue` with loading / error / empty state
  - Add-friend calls `POST /api/friends` with inline error display
  - Create-room error surfaced inline (was silent)
  - Join-with-code has inline validation error
- Created `packages/web/.env.example` listing all required env vars:
  - `API_BACKEND_URL` (Next.js server-side rewrites)
  - `NEXT_PUBLIC_WS_URL` (client-side WebSocket)
  - `NEXT_PUBLIC_API_URL` (client-side REST, optional if proxied)

### Done
- `GET /api/friends` verified and connected
- `GET /api/rooms` added on server to return live auditories with members & metadata
- Auth converted to HttpOnly cookies and AuthContext in Phase 2
- Route protection (lobby/room redirect unauthenticated users) implemented in Phase 2

---

## Phase 2 – Auth ✅
- **Auth Architecture**: Built `packages/web/src/lib/AuthContext.tsx` providing real `signIn`, `signUp`, `signOut`, `continueAsGuest`, token auto-refresh, and user state.
- **Ticket Booth UI**: Rewrote `packages/web/src/components/TicketBoothAuth.tsx` to call real endpoints with animated error shake, film strip password meter, invite code validation, and `React.Suspense` wrapping for SSR safety.
- **Guest Access**: Added `/api/auth/guest` endpoint in `packages/server/src/auth/api/authRoutes.ts`.
- **CORS & Credentials**: Fixed CORS in `authRoutes.ts` and `friendsRoutes.ts` to dynamically reflect request origin for credentials support, and added `https://*.vercel.app` to allowed origins.
- **Route Protection**: Unauthenticated users visiting `/lobby` and `/room/[code]` are automatically redirected to `/login?next=...`.

---

## Phase 3 – Lobby & Room, Fully Real ✅
- **Live Auditories Feed**: Implemented `GET /api/rooms` and enhanced `GET /api/rooms/:code` in server to return live member counts, host names, and current media titles.
- **Lobby Redesign**: Rewrote `packages/web/src/app/lobby/page.tsx` with live public auditories, real friend list with presence indicators, friend request management, inline code verification, and zero mock data.
- **Join Tickets**: Cleaned `packages/web/src/app/join/page.tsx`, `packages/web/src/app/join/[code]/page.tsx`, and `packages/web/src/components/RoomInviteTicket.tsx` of all static mock names (Elena Rostova, 2001, CRITERION-70MM).

---

## Phase 4 – Source Picker ✅
- **SourcePickerSheet**: Implemented `packages/web/src/components/theatre/SourcePickerSheet.tsx` with 4 source modes:
  1. *Free Library*: Public domain and CC catalogue.
  2. *Paste Link*: YouTube, Vimeo, direct MP4, podcast RSS via SSRF-protected `/api/resolve`.
  3. *Local File*: Zero-upload client-side playback synced by SHA-256 fingerprint and file size.
  4. *Platforms*: Netflix, JioHotstar, Prime Video, Disney+, YouTube, Max with extension detection and direct launch.
- **Auditorium Integration**: Connected `SourcePickerSheet` to `TheatreAuditorium.tsx` via the `+ Source` button to broadcast `PLAYBACK_CHANGE_VIDEO` and `PLAYLIST_ADD` over WebSocket.

---

## Phase 5 – Browser Extension ✅
- **JioHotstar Support**: Added JioHotstar streaming adapter rule and selector configurations in `packages/extension/src/config/siteConfig.ts` and `manifest.json`.
- **Extension Tests & Build**: Tested all 22 extension tests (`test:extension` passing) and compiled with Vite.

---

## Phase 6 – Final Verification ✅
- **Zero Mock Strings**: All forbidden mock references (`Priya`, `Sam`, `Meera`, `Rohan`, `Grand Auditorium`, `Elena`, `Marcus`, `CRITERION-70MM`, `RM-4F7K`, `Elephants Dream`, `Big Buck Bunny`) purged across `packages/web/src`.
- **Test Suites**:
  - `npm run test:web`: 47/47 passing
  - `npm run test:server`: 331/331 passing
  - `npm run test:extension`: 22/22 passing
- **Production Build**: `npm run build:web` succeeds cleanly with all static and dynamic routes prerendered.

---

## Phase 7 – Native App Experience & Progressive Web App (PWA) ✅
- **App Router Web App Manifest**: Created `packages/web/src/app/manifest.ts` exporting standalone display, portrait-primary orientation, `#0E0B09` theme and background colors, and icon definitions.
- **Mobile Viewport & Safe Area Insets**: Exported Next.js 14 `viewport` metadata in `packages/web/src/app/layout.tsx` (`viewportFit: 'cover'`, `width: 'device-width'`, `initialScale: 1`, `maximumScale: 1`, `userScalable: false`). Added `.safe-top` and `.safe-bottom` CSS utilities in `packages/web/src/app/globals.css`.
- **Install App Banner**: Created `packages/web/src/components/InstallAppBanner.tsx` capturing `beforeinstallprompt` event for Android and Desktop Chrome, and providing iOS Safari manual install guidance ("Tap Share > Add to Home Screen"). Wired into `TheatreAuditorium.tsx`.
- **Screen WakeLock API**: Created `packages/web/src/lib/useWakeLock.ts` acquiring `navigator.wakeLock.request('screen')` during active playback and auto-reacquiring upon tab visibility recovery. Integrated into `TheatreAuditorium.tsx`.
- **Picture-in-Picture & MediaSession API**: Created `packages/web/src/lib/useMediaSession.ts` exposing play, pause, seekforward, seekbackward lockscreen and notification shade actions. Added dedicated PiP toggle button (`PictureInPictureIcon`) in `TheatreAuditorium.tsx`.
- **Web Push Service Worker**: Created `packages/web/public/sw.js` handling `push` events (action buttons `[ Join Screening ]` / `[ Dismiss ]`) and `notificationclick` events (focusing existing tabs or navigating to target room). Generated 192px and 512px SVG and PNG cinema icons in `packages/web/public/`.

---

## Phase 8 – Universal Cross-Platform Bridge & Extension DRM Architecture ✅
- **Universal Platform Bridge**: Created `packages/web/src/lib/platformBridge.ts` providing deep linking and extension handshake for Netflix, JioHotstar, Prime Video, Disney+, Max, and YouTube across Desktop, Android, and iOS.
- **External Projection Bridge**: Stage displays the External Projection Bridge Card on stage when DRM-protected media is active. Automatically probes for `@watchparty/extension` via `window.postMessage` and triggers synchronized playback tabs while keeping room voice chat and text active.
- **Extension Permissions & Manifest**: Updated `packages/extension/manifest.json` and `packages/extension/src/content/content.ts` with permissions for JioHotstar (`hotstar.com`) and JioCinema (`jiocinema.com`).
- **Audio Auto-Ducking**: Configured voice chat detector in `TheatreAuditorium.tsx` to automatically duck video volume to 35% when peers speak with a 600ms restore delay and an `Auto-Duck: ON/OFF` toggle in the player controls.
- **Backend Infrastructure**: Real reverse proxy IP resolution (`getClientIp(req)` supporting `Fly-Client-IP`, `X-Forwarded-For`, `X-Real-IP`, `TRUST_PROXY`), STUN/TURN WebRTC credentials (`GET /api/rtc/ice-servers`), live debounced search (`GET /api/search`), and background 60s chat message pruning in `RoomManager.ts`.

---

## Phase 9 – Final Quality Gate & Build Verification ✅
- **Monorepo Typecheck**: Verified `npm run typecheck` across all 5 packages (`@watchparty/shared`, `@watchparty/server`, `@watchparty/client`, `@watchparty/extension`, `@watchparty/web`) with zero errors.
- **Server Test Suite**: 24/24 test files passing, 331/331 tests passing (`npm run test:server`).
- **Web App Test Suite**: 5/5 test files passing, 47/47 tests passing (`npm run test:web`).
- **Browser Extension Test Suite**: 4/4 test files passing, 22/22 tests passing (`npm run test:extension`).
- **Complete Test Matrix**: 400/400 tests passing across 33 test suites with zero failures.
- **Production Bundle**: Next.js production build succeeded cleanly (`npm run build:web`), prerendering 13 static pages, configuring dynamic API routes, and linking the PWA manifest and service worker.



