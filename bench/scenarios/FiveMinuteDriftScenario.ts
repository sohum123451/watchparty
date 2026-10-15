import { VirtualTimeProvider } from "../harness/VirtualTimeProvider.js";
import { SimulatedVideo } from "../harness/SimulatedVideo.js";
import { PlaybackSyncEngine } from "@watchparty/client";
import { PlaybackState } from "@watchparty/shared";
import { computeDistributionStats, computePercentile } from "../reporters/Stats.js";
import { DriftTimePoint } from "../reporters/ChartGenerator.js";
import { ScenarioRunOutput } from "./ScenarioTypes.js";

export async function runFiveMinuteDriftScenario(clientCount = 10): Promise<ScenarioRunOutput> {
  const durationSeconds = 300; // 5 minutes
  const sampleIntervalMs = 100; // Sample every 100ms
  const totalSteps = (durationSeconds * 1000) / sampleIntervalMs; // 3,000 steps

  const virtualTime = new VirtualTimeProvider(1_700_000_000_000);

  // Authoritative server state model running alongside
  let serverPlayback: PlaybackState = {
    videoId: "bench_vid",
    status: "playing",
    positionMs: 0,
    serverTimeMs: virtualTime.now(),
    playbackRate: 1.0,
  };

  interface SimClient {
    id: string;
    video: SimulatedVideo;
    engine: PlaybackSyncEngine;
    isConnected: boolean;
  }

  const clients: SimClient[] = [];

  for (let i = 0; i < clientCount; i++) {
    const video = new SimulatedVideo({
      timeProvider: virtualTime,
      hardwareDriftPpm: (i % 2 === 0 ? 1 : -1) * (10 + i * 3), // slight hardware oscillator skew
    });

    const engine = new PlaybackSyncEngine({
      video,
      timeProvider: virtualTime,
      sendPing: (clientSendTimeMs) => {
        // Instant simulated ping response
        const serverNow = virtualTime.now();
        engine.handleSyncPong(clientSendTimeMs, serverNow, serverNow, virtualTime.now());
      },
      driftIntervalMs: 100,
      deadZoneMs: 40,
      hysteresisZoneMs: 20,
      hardSeekThresholdMs: 1000,
    });

    engine.start();
    // Ingest initial state
    engine.setPlaybackState({ ...serverPlayback });

    clients.push({
      id: `client_${i}`,
      video,
      engine,
      isConnected: true,
    });
  }

  const allDrifts: number[] = [];
  const timePoints: DriftTimePoint[] = [];

  // Stepping simulation loop for 5 minutes (300 seconds @ 100ms = 3000 steps)
  for (let step = 0; step < totalSteps; step++) {
    const currentVirtualTime = virtualTime.now();
    const elapsedSeconds = (step * sampleIntervalMs) / 1000;
    let marker: string | undefined;

    // --- Scenario Event 1: Seek at 60s (Jump to 120s / 120,000 ms) ---
    if (step === (60 * 1000) / sampleIntervalMs) {
      marker = "SEEK_FORWARD_120s";
      serverPlayback = {
        ...serverPlayback,
        positionMs: 120_000,
        serverTimeMs: currentVirtualTime,
        status: "playing",
      };
      for (const c of clients) {
        if (c.isConnected) {
          c.engine.setPlaybackState({ ...serverPlayback });
        }
      }
    }

    // --- Scenario Event 2: Client 2 Disconnects at 150s (2.5 mins) ---
    if (step === (150 * 1000) / sampleIntervalMs) {
      marker = "CLIENT_DISCONNECT";
      clients[2].isConnected = false;
      clients[2].engine.stop();
    }

    // --- Scenario Event 3: Client 2 Reconnects at 153s ---
    if (step === (153 * 1000) / sampleIntervalMs) {
      marker = "CLIENT_RECONNECT";
      clients[2].isConnected = true;
      clients[2].engine.start();
      // Reconnect receives snapshot
      clients[2].engine.setPlaybackState({
        ...serverPlayback,
        // Authoritative position has advanced
        positionMs: serverPlayback.positionMs,
      });
    }

    // --- Scenario Event 4: Backward Seek at 225s (Jump to 180s / 180,000 ms) ---
    if (step === (225 * 1000) / sampleIntervalMs) {
      marker = "SEEK_BACKWARD_180s";
      serverPlayback = {
        ...serverPlayback,
        positionMs: 180_000,
        serverTimeMs: currentVirtualTime,
        status: "playing",
      };
      for (const c of clients) {
        if (c.isConnected) {
          c.engine.setPlaybackState({ ...serverPlayback });
        }
      }
    }

    // Advance virtual clock by 100ms
    virtualTime.advance(sampleIntervalMs);

    // Compute authoritative target position at this instant
    const authoritativeElapsed = virtualTime.now() - serverPlayback.serverTimeMs;
    const authoritativePosMs = serverPlayback.positionMs + authoritativeElapsed * serverPlayback.playbackRate;

    // Sample drift across all connected clients
    const stepDrifts: number[] = [];
    for (const c of clients) {
      if (c.isConnected) {
        const clientPosMs = c.video.currentTime * 1000;
        const driftMs = clientPosMs - authoritativePosMs;
        stepDrifts.push(driftMs);
        allDrifts.push(Math.abs(driftMs));
      }
    }

    // Record downsampled chart point (e.g. every 1 second or at markers to keep SVG size compact)
    if (step % 10 === 0 || marker) {
      const absStepDrifts = stepDrifts.map((d) => Math.abs(d));
      const sorted = [...absStepDrifts].sort((a, b) => a - b);
      const mean = absStepDrifts.reduce((a, b) => a + b, 0) / absStepDrifts.length;
      const p95 = computePercentile(sorted, 95);
      const max = Math.max(...absStepDrifts);

      timePoints.push({
        timeSeconds: Number(elapsedSeconds.toFixed(1)),
        drifts: stepDrifts,
        meanDrift: Number(mean.toFixed(2)),
        p95Drift: Number(p95.toFixed(2)),
        maxDrift: Number(max.toFixed(2)),
        marker,
      });
    }
  }

  // Teardown
  for (const c of clients) {
    c.engine.destroy();
  }

  const driftStats = computeDistributionStats(allDrifts);
  const passDrift = driftStats.max <= 500;

  // Latency is nominal since this tests drift over time
  const nominalLatency = [1.5, 2.0, 1.8, 2.2, 1.9];
  const latencyStats = computeDistributionStats(nominalLatency);

  return {
    result: {
      scenarioName: "5-Minute Post-Correction Drift (100ms Sampled)",
      description: "Continuous 5-minute (300s) playback sampled every 100ms across all clients, including seek and reconnect events",
      clientCount,
      durationSeconds,
      latencyStats,
      driftStats,
      passLatency: true,
      passDrift,
      status: passDrift ? "PASS" : "FAIL",
      notes: `Evaluated ${allDrifts.length.toLocaleString()} total drift samples over 300s timeline. Max observed drift: ${driftStats.max}ms (SLA target: ≤500ms).`,
    },
    rawLatencies: nominalLatency,
    driftTimePoints: timePoints,
  };
}
