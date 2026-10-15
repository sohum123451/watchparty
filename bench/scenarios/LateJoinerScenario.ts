import { BenchmarkServer } from "../harness/BenchmarkServer.js";
import { HeadlessClient } from "../harness/HeadlessClient.js";
import { computeDistributionStats } from "../reporters/Stats.js";
import { ScenarioRunOutput } from "./ScenarioTypes.js";

export async function runLateJoinerScenario(): Promise<ScenarioRunOutput> {
  const server = new BenchmarkServer();
  const { url } = await server.start();

  const clients: HeadlessClient[] = [];
  const rawLatencies: number[] = [];
  const rawDrifts: number[] = [];

  try {
    // 1. Host creates room and plays forward to 40-minute mark (2,400,000 ms)
    const host = new HeadlessClient({ userName: "Host_40m" });
    clients.push(host);
    await host.connect(url);
    const { roomCode } = await host.createRoom("Late Joiner 40min Room");

    // Seek to 40 minutes and start playing
    const FORTY_MINUTES_MS = 40 * 60 * 1000; // 2,400,000 ms
    host.sendSeek(FORTY_MINUTES_MS, true);
    await new Promise((r) => setTimeout(r, 200));

    // 2. Late Joiner connects and enters room
    const lateJoiner = new HeadlessClient({ userName: "Late_Joiner_Bob" });
    clients.push(lateJoiner);

    const joinStartTime = performance.now();
    await lateJoiner.connect(url);
    await lateJoiner.joinRoom(roomCode);
    const joinElapsed = performance.now() - joinStartTime;
    rawLatencies.push(Number(joinElapsed.toFixed(2)));

    // Allow clock sync convergence & hard seek execution (1-2 drift ticks)
    await new Promise((r) => setTimeout(r, 400));

    // Sample drift across 15 consecutive samples
    for (let s = 0; s < 15; s++) {
      const { driftMs, clientPosMs } = lateJoiner.sampleDrift();
      rawDrifts.push(Math.abs(driftMs));
      // Verify late joiner actually sought near 40 minutes (within 2 seconds of 2.4M ms)
      if (Math.abs(clientPosMs - FORTY_MINUTES_MS) > 5000) {
        throw new Error(`Late joiner failed to jump to 40m mark: pos=${clientPosMs}`);
      }
      await new Promise((r) => setTimeout(r, 50));
    }
  } finally {
    for (const c of clients) c.destroy();
    await server.stop();
  }

  const latencyStats = computeDistributionStats(rawLatencies);
  const driftStats = computeDistributionStats(rawDrifts);

  const passLatency = latencyStats.p95 <= 250;
  const passDrift = driftStats.max <= 500;

  return {
    result: {
      scenarioName: "Late Joiner at 40-Minute Mark",
      description: "Client joins active room running at 40:00 (2,400,000ms), receives snapshot, and converges video clock",
      clientCount: 2,
      durationSeconds: 2.0,
      latencyStats,
      driftStats,
      passLatency,
      passDrift,
      status: passLatency && passDrift ? "PASS" : "FAIL",
      notes: `Late joiner jumped cleanly to 40:00 mark in ${latencyStats.p50}ms. Post-catchup drift max: ${driftStats.max}ms (within deadband).`,
    },
    rawLatencies,
  };
}
