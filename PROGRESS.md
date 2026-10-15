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

### Broken / Not yet done
- `GET /api/friends` and `GET /api/catalogue` must exist on the server
  (checked separately – server already has `/api/friends`; `/api/catalogue` needs verification)
- Auth is still using sessionStorage tokens, not HttpOnly cookies (Phase 2)
- Route protection (lobby/room require session) not yet implemented (Phase 2)

---

## Phase 2 – Auth ⏳ (next)
## Phase 3 – Lobby & Room, Fully Real ⏳
## Phase 4 – Source Picker ⏳
## Phase 5 – Browser Extension ⏳
## Phase 6 – Final Verification ⏳
