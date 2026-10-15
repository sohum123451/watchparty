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

