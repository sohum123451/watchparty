# Chrome Web Store Listing: WatchParty - Stream Synchronizer

This document is the single source of truth for the Chrome Web Store Developer Dashboard listing, permissions justifications, privacy policy, and publishing readiness.

---

## 1. Store Listing Metadata

### Name
**WatchParty - Stream Synchronizer**

### Summary / Short Description (132 characters max)
*Synchronize video playback across Netflix, Disney+, Prime Video, YouTube, Hulu, and Max with friends in real time.*
*(Character count: 119)*

### Category
**Productivity / Social & Communication**

### Detailed Description

```markdown
Watch movies and shows together with friends, synchronized down to the millisecond across major streaming services!

WatchParty links your browser to virtual watch party rooms. When any friend plays, pauses, or seeks, your video stays perfectly in sync without messy countdowns or manual adjustments.

🌟 KEY FEATURES
• Precision Drift Engine: Automatically keeps all viewers within 50ms sync using smooth, micro-rate nudging and adaptive seeking.
• Universal Streaming Compatibility: Native support for Netflix, Disney+, Amazon Prime Video, YouTube, Hulu, and Max.
• Zero-Proxy Security & Legitimate Access: WatchParty never proxies, intercepts, or downloads video streams. Every member uses their own legitimate streaming subscription.
• Unobtrusive In-Video HUD: Floating, transparent sync status pill showing room connection, drift, and host role.
• Flexible Host Mode: Toggle "I'm the Host" to command playback for the whole party, or let members enjoy free-form collaborative control.
• Single-Page-App (SPA) Support: Dynamic navigation on modern streaming platforms works seamlessly without page refreshes.

🔒 PRIVACY & SECURITY FIRST
• Zero Browsing History Access: WatchParty never tracks, stores, or transmits your search history or web activity.
• Zero Credential Access: The extension cannot access your streaming passwords, session cookies, payment info, or profile data.
• Minimal Signals: Only playback timestamps (currentTime, playing/paused status) and room signaling messages are exchanged.
```

---

## 2. Permissions Justification

The Chrome Web Store review team requires specific, plain-English reasons for every requested permission.

| Permission | Technical Reason | User-Facing Benefit |
| :--- | :--- | :--- |
| `storage` | Used to save the user's active room ID, server URL preference, and host role preference. | Keeps the user connected to their watch party across browser restarts and tab refreshes without losing settings. |
| `alarms` | Used to trigger periodic NTP clock synchronization with the room server every 60 seconds. | Calibrates client and server clock offsets so video timestamps remain drift-free throughout long movies. |
| `tabs` | Used by the background service worker to detect when an active streaming tab navigates or closes, and to route playback state to the active player. | Automatically re-attaches the synchronizer when clicking to the next episode in a series without manual setup. |

### Host Permissions Justification

| Host Pattern | Specific Plain-English Justification |
| :--- | :--- |
| `https://*.netflix.com/*` | Required to inject the content script on Netflix playback pages so it can attach to the HTML5 video element and read/apply play, pause, and seek events. |
| `https://*.disneyplus.com/*` | Required to detect the Disney+ player `<video>` element and apply synchronized playback rate nudging and position sync. |
| `https://*.amazon.com/*` | Required to locate the Prime Video web player container on Amazon and sync playback actions. |
| `https://*.primevideo.com/*` | Required to locate the Prime Video standalone player `<video>` element for party synchronization. |
| `https://*.youtube.com/*` | Required to monitor and sync YouTube video playback timestamps for watch party rooms. |
| `https://*.hulu.com/*` | Required to detect the Hulu web player and synchronize play/pause/seek events with room members. |
| `https://*.max.com/*` | Required to attach to the Max (formerly HBO Max) player to sync playback timestamps. |
| `http://localhost/*` | Developer and self-hosted testing: permits synchronization with local WatchParty server instances. |
| `http://127.0.0.1/*` | Developer and self-hosted testing: permits synchronization with local loopback endpoints. |

---

## 3. Privacy Policy & Data Use Disclosure

### Data Collection Disclosure
- **Personal Information**: None collected.
- **Personally Identifiable Information (PII)**: None collected.
- **Authentication Credentials**: None collected. The extension operates in the context of the user's existing logged-in session and never reads authentication cookies or login tokens.
- **Web Browsing Activity**: None collected. The extension only activates on streaming playback tabs when a room code has been joined.
- **Website Content**: None collected. The extension does not record, copy, or proxy video or audio content.

### Data Transmission Disclosure
- Playback status (`currentTime` in ms, `paused` boolean, `playbackRate` float) and Room ID are transmitted via encrypted WebSocket to the user's designated WatchParty server.
- No analytics trackers, advertising IDs, or third-party telemetry libraries are included in the package.

---

## 4. Visual Assets & Packaging Checklist

- [x] **Icons**:
  - `icons/icon-16.png` (16x16 px)
  - `icons/icon-48.png` (48x48 px)
  - `icons/icon-128.png` (128x128 px)
- [x] **Manifest V3 Validated**:
  - No Manifest V2 APIs
  - Service worker background script (`dist/background/serviceWorker.js`)
  - No inline `<script>` tags or inline DOM handlers in `popup.html`
- [ ] **Store Screenshots (To capture before publishing)**:
  - Screenshot 1 (1280x800): Popup UI with active room code and drift readout
  - Screenshot 2 (1280x800): Video player on streaming service showing injected WatchParty HUD
  - Screenshot 3 (1280x800): Host mode toggle and party controls

---

## 5. Version History

- **v1.0.0** (2026-10-14):
  - Initial Manifest V3 release.
  - Cross-platform support for Netflix, Disney+, Prime Video, YouTube, Hulu, and Max.
  - NTP clock calibration and micro-nudge drift engine (<50ms deadband, 0.95x/1.05x rate nudging, hard seek >500ms).
  - Unobtrusive, dark-glassmorphism video HUD and popup control panel.
  - Strict zero-proxy privacy architecture.
