import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ExtensionSyncEngine, RoomPlaybackState } from "../src/sync/ExtensionSyncEngine.js";
import { PlayerAdapter, PlayerState } from "../src/adapter/StreamingPageAdapter.js";

describe("ExtensionSyncEngine", () => {
  let mockAdapter: PlayerAdapter;
  let syncEngine: ExtensionSyncEngine;

  let localTime: number;
  let localState: PlayerState;
  let currentRate: number;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1000000);

    localTime = 10000;
    localState = "playing";
    currentRate = 1.0;

    mockAdapter = {
      provider: "extension",
      capabilities: {
        supportsPlaybackRate: true,
        supportsPreciseSeek: true,
        isLive: false,
        canAutoplay: true
      },
      load: vi.fn(),
      play: vi.fn().mockImplementation(() => { localState = "playing"; }),
      pause: vi.fn().mockImplementation(() => { localState = "paused"; }),
      seek: vi.fn().mockImplementation((ms: number) => { localTime = ms; }),
      getCurrentTime: vi.fn().mockImplementation(() => localTime),
      getState: vi.fn().mockImplementation(() => localState),
      setPlaybackRate: vi.fn().mockImplementation((r: number) => { currentRate = r; }),
      getDuration: vi.fn().mockReturnValue(3600000),
      onStateChange: vi.fn().mockReturnValue(() => {}),
      onBuffering: vi.fn().mockReturnValue(() => {}),
      onEnded: vi.fn().mockReturnValue(() => {}),
      onError: vi.fn().mockReturnValue(() => {})
    };

    (mockAdapter as any).getPlaybackRate = () => currentRate;

    syncEngine = new ExtensionSyncEngine(mockAdapter, {
      deadbandMs: 50,
      hardSeekThresholdMs: 500,
      nudgeSlowdownRatio: 0.95,
      nudgeSpeedupRatio: 1.05
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should maintain normal playback within deadband (<= 50ms drift)", () => {
    const roomState: RoomPlaybackState = {
      roomId: "ROOM-1",
      state: "playing",
      positionMs: 10020, // 20ms difference (within 50ms deadband)
      playbackRate: 1.0,
      updatedAtServerMs: Date.now(),
      isHost: false
    };

    const metrics = syncEngine.updateRoomState(roomState);

    expect(metrics?.mode).toBe("in-sync");
    expect(mockAdapter.setPlaybackRate).toHaveBeenCalledWith(1.0);
    expect(mockAdapter.seek).not.toHaveBeenCalled();
  });

  it("should nudge playback rate when drift is moderate (50ms < drift <= 500ms)", () => {
    // Local time is 10000, room is 9800 -> local is ahead by 200ms -> should slow down to 0.95x
    const roomStateAhead: RoomPlaybackState = {
      roomId: "ROOM-1",
      state: "playing",
      positionMs: 9800,
      playbackRate: 1.0,
      updatedAtServerMs: Date.now(),
      isHost: false
    };

    let metrics = syncEngine.updateRoomState(roomStateAhead);
    expect(metrics?.mode).toBe("nudging");
    expect(metrics?.driftMs).toBe(200);
    expect(mockAdapter.setPlaybackRate).toHaveBeenCalledWith(0.95);
    expect(mockAdapter.seek).not.toHaveBeenCalled();

    // Local time is 10000, room is 10300 -> local is behind by 300ms -> should speed up to 1.05x
    const roomStateBehind: RoomPlaybackState = {
      roomId: "ROOM-1",
      state: "playing",
      positionMs: 10300,
      playbackRate: 1.0,
      updatedAtServerMs: Date.now(),
      isHost: false
    };

    metrics = syncEngine.updateRoomState(roomStateBehind);
    expect(metrics?.mode).toBe("nudging");
    expect(metrics?.driftMs).toBe(-300);
    expect(mockAdapter.setPlaybackRate).toHaveBeenCalledWith(1.05);
    expect(mockAdapter.seek).not.toHaveBeenCalled();
  });

  it("should perform hard seek when drift exceeds hardSeekThreshold (> 500ms)", () => {
    // Local time is 10000, room is 15000 -> drift is -5000ms
    const roomStateFar: RoomPlaybackState = {
      roomId: "ROOM-1",
      state: "playing",
      positionMs: 15000,
      playbackRate: 1.0,
      updatedAtServerMs: Date.now(),
      isHost: false
    };

    const metrics = syncEngine.updateRoomState(roomStateFar);

    expect(metrics?.mode).toBe("seeking");
    expect(mockAdapter.seek).toHaveBeenCalledWith(15000);
    expect(mockAdapter.setPlaybackRate).toHaveBeenCalledWith(1.0);
  });

  it("should pause local video when room state is paused", () => {
    const roomStatePaused: RoomPlaybackState = {
      roomId: "ROOM-1",
      state: "paused",
      positionMs: 10000,
      playbackRate: 1.0,
      updatedAtServerMs: Date.now(),
      isHost: false
    };

    const metrics = syncEngine.updateRoomState(roomStatePaused);

    expect(metrics?.mode).toBe("paused");
    expect(mockAdapter.pause).toHaveBeenCalled();
  });

  it("should not adjust local playback when user is host", () => {
    syncEngine.setHost(true);

    const roomState: RoomPlaybackState = {
      roomId: "ROOM-1",
      state: "playing",
      positionMs: 5000, // Large mismatch
      playbackRate: 1.0,
      updatedAtServerMs: Date.now(),
      isHost: true
    };

    syncEngine.updateRoomState(roomState);
    const metrics = syncEngine.evaluateSync();

    expect(metrics.driftMs).toBe(0);
    expect(metrics.mode).toBe("in-sync");
    expect(mockAdapter.seek).not.toHaveBeenCalled();
  });
});
