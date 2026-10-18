'use client';

/**
 * Universal Platform Bridge
 * Unified coordination across Desktop Browser + Extension, Mobile In-App WebViews,
 * and Desktop Tauri/Electron wrappers for DRM platforms (Netflix, JioHotstar, Prime, etc.)
 */

export interface ExternalStreamPayload {
  provider: 'netflix' | 'jiohotstar' | 'hotstar' | 'prime' | 'disney' | 'max' | string;
  url: string;
  roomCode: string;
  playbackState?: {
    currentTime: number;
    paused: boolean;
    playbackRate?: number;
  };
}

let extensionDetected = false;
let extensionVersion = '';

if (typeof window !== 'undefined') {
  // Listen for handshake from @watchparty/extension content script
  window.addEventListener('message', (event) => {
    if (event.data?.source === 'WATCHPARTY_EXTENSION' && event.data?.type === 'EXTENSION_INSTALLED') {
      extensionDetected = true;
      extensionVersion = event.data?.version || '1.0.0';
    }
  });

  // Announce web app presence to prompt extension response
  window.postMessage({ source: 'WATCHPARTY_WEB', type: 'PING_EXTENSION' }, '*');
}

export function isNativeMobileWrapper(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as any;
  return Boolean(w.Capacitor || w.ReactNativeWebView || w.webkit?.messageHandlers?.watchparty);
}

export function isNativeDesktopWrapper(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as any;
  return Boolean(w.__TAURI_INTERNALS__ || w.watchpartyNative || w.electronAPI);
}

export function isExtensionAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  return extensionDetected || Boolean((window as any).__WATCHPARTY_EXTENSION_AVAILABLE__);
}

export function getPlatformRuntime(): 'native-mobile' | 'native-desktop' | 'browser-extension' | 'browser-web' {
  if (isNativeMobileWrapper()) return 'native-mobile';
  if (isNativeDesktopWrapper()) return 'native-desktop';
  if (isExtensionAvailable()) return 'browser-extension';
  return 'browser-web';
}

/**
 * Launches or attaches external DRM stream depending on the active runtime environment.
 */
export async function launchOrSyncExternalStream(payload: ExternalStreamPayload): Promise<{
  success: boolean;
  runtime: string;
  message?: string;
}> {
  const runtime = getPlatformRuntime();

  if (runtime === 'native-mobile' || runtime === 'native-desktop') {
    const w = window as any;
    if (w.watchpartyNative?.launchDrmStream) {
      w.watchpartyNative.launchDrmStream(payload);
    } else if (w.ReactNativeWebView?.postMessage) {
      w.ReactNativeWebView.postMessage(JSON.stringify({ type: 'LAUNCH_DRM_STREAM', ...payload }));
    } else if (w.webkit?.messageHandlers?.watchparty?.postMessage) {
      w.webkit.messageHandlers.watchparty.postMessage({ type: 'LAUNCH_DRM_STREAM', ...payload });
    }
    return { success: true, runtime, message: 'Mounted in native app webview' };
  }

  if (runtime === 'browser-extension') {
    // Send message to extension content script / background worker
    window.postMessage(
      {
        source: 'WATCHPARTY_WEB',
        type: 'WATCHPARTY_LAUNCH_STREAM',
        payload,
      },
      '*'
    );
    window.open(payload.url, '_blank');
    return { success: true, runtime, message: 'Launched in external tab with extension sync' };
  }

  // Fallback for standard mobile/desktop browser without extension
  window.open(payload.url, '_blank');
  return {
    success: false,
    runtime,
    message: 'Opened in external tab. Install WatchParty extension or run tab sharing for automated sync.',
  };
}
