import { describe, it, expect, vi, beforeEach } from "vitest";
import { StreamingPageAdapter } from "../src/adapter/StreamingPageAdapter.js";

// Mock HTMLVideoElement
class MockVideoElement {
  public currentTime: number = 0;
  public duration: number = 120;
  public paused: boolean = true;
  public ended: boolean = false;
  public readyState: number = 4;
  public seeking: boolean = false;
  public playbackRate: number = 1.0;

  private listeners: Record<string, Set<EventListener>> = {};

  public addEventListener(event: string, handler: EventListener): void {
    if (!this.listeners[event]) this.listeners[event] = new Set();
    this.listeners[event].add(handler);
  }

  public removeEventListener(event: string, handler: EventListener): void {
    if (this.listeners[event]) {
      this.listeners[event].delete(handler);
    }
  }

  public dispatchMockEvent(event: string): void {
    const handlers = this.listeners[event];
    if (handlers) {
      handlers.forEach((fn) => fn(new Event(event)));
    }
  }

  public play = vi.fn().mockImplementation(async () => {
    this.paused = false;
    this.dispatchMockEvent("play");
    this.dispatchMockEvent("playing");
  });

  public pause = vi.fn().mockImplementation(() => {
    this.paused = true;
    this.dispatchMockEvent("pause");
  });
}

describe("StreamingPageAdapter", () => {
  let mockVideo: MockVideoElement;
  let adapter: StreamingPageAdapter;

  beforeEach(() => {
    mockVideo = new MockVideoElement();
    adapter = new StreamingPageAdapter(mockVideo as unknown as HTMLVideoElement);
  });

  it("should report capabilities correctly", () => {
    expect(adapter.provider).toBe("extension");
    expect(adapter.capabilities.supportsPlaybackRate).toBe(true);
    expect(adapter.capabilities.supportsPreciseSeek).toBe(true);
    expect(adapter.capabilities.isLive).toBe(false);
  });

  it("should convert time and duration to milliseconds", () => {
    mockVideo.currentTime = 14.5;
    expect(adapter.getCurrentTime()).toBe(14500);

    mockVideo.duration = 180.25;
    expect(adapter.getDuration()).toBe(180250);
  });

  it("should map player state accurately", () => {
    mockVideo.paused = true;
    expect(adapter.getState()).toBe("paused");

    mockVideo.paused = false;
    expect(adapter.getState()).toBe("playing");

    mockVideo.seeking = true;
    expect(adapter.getState()).toBe("buffering");

    mockVideo.seeking = false;
    mockVideo.ended = true;
    expect(adapter.getState()).toBe("ended");
  });

  it("should suppress programmatic events to prevent echo loops", async () => {
    const onStateChange = vi.fn();
    adapter.onStateChange(onStateChange);

    // Calling play() programmatically marks isProgrammaticAction
    await adapter.play();
    expect(adapter.isSuppressed()).toBe(true);

    // Because play was programmatic, our adapter listener suppresses the echo
    expect(onStateChange).not.toHaveBeenCalled();

    // Now simulate an organic user click on the player
    // First, let suppression timer expire or artificially reset
    (adapter as any).isProgrammaticAction = false;
    mockVideo.dispatchMockEvent("pause");
    expect(onStateChange).toHaveBeenCalledWith("paused");
  });

  it("should handle seek and playbackRate clamping", () => {
    adapter.seek(42000);
    expect(mockVideo.currentTime).toBe(42);

    adapter.setPlaybackRate(1.25);
    expect(mockVideo.playbackRate).toBe(1.25);

    // Clamps excessive rates
    adapter.setPlaybackRate(10);
    expect(mockVideo.playbackRate).toBe(4.0);

    adapter.setPlaybackRate(0.01);
    expect(mockVideo.playbackRate).toBe(0.25);
  });

  it("should clean up event listeners on destroy", () => {
    const onStateChange = vi.fn();
    const unsub = adapter.onStateChange(onStateChange);
    unsub();

    adapter.destroy();
    (adapter as any).isProgrammaticAction = false;
    mockVideo.dispatchMockEvent("play");
    expect(onStateChange).not.toHaveBeenCalled();
  });
});
