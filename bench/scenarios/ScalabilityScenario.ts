import { BenchmarkServer } from "../harness/BenchmarkServer.js";
import { HeadlessClient } from "../harness/HeadlessClient.js";
import { computeDistributionStats } from "../reporters/Stats.js";
import { ScenarioRunOutput } from "./ScenarioTypes.js";

export async function runScalabilityScenario(clientCount: number): Promise<ScenarioRunOutput> {
  const server = new BenchmarkServer();
  const { url } = await server.start();

  const clients: HeadlessClient[] = [];
  const rawLatencies: number[] = [];
  const rawDrifts: number[] = [];

  try {
    // 1. Initialize Host
    const host = new HeadlessClient({ userName: "Host_User" });
    clients.push(host);
    await host.connect(url);
    const { roomCode } = await host.createRoom(`Scalability Room ${clientCount}`);

    // 2. Initialize remaining N-1 clients concurrently in chunks
    const joinPromises: Promise<void>[] = [];
    for (let i = 1; i < clientCount; i++) {
      const client = new HeadlessClient({
        userName: `Client_${i}`,
        hardwareDriftPpm: (i % 2 === 0 ? 1 : -1) * (i * 2), // realistic minor clock skew
      });
      clients.push(client);
      joinPromises.push(
        client.connect(url).then(() => client.joinRoom(roomCode))
      );
    }
    await Promise.all(joinPromises);

    // 3. Allow NTP synchronization burst to converge
    await new Promise((r) => setTimeout(r, 400));

    // 4. Setup Command Propagation Latency tracking
    // For each command issued, track latency to every client receiving the PLAYBACK_UPDATE
    const trackCommand = async (
      action: "play" | "pause" | "seek",
      sender: HeadlessClient,
      param?: number
    ): Promise<void> => {
      const targetClients = clients.filter((c) => c.userId !== sender.userId);
      const pendingClientIds = new Set(targetClients.map((c) => c.userId));
      const tSend = performance.now();

      return new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          cleanup();
          resolve();
        }, 3000);

        const unsubs: (() => void)[] = [];

        const cleanup = () => {
          clearTimeout(timeout);
          for (const u of unsubs) u();
        };

        for (const c of targetClients) {
          const unsub = c.onPlaybackUpdate((update) => {
            if (pendingClientIds.has(c.userId)) {
              const tRecv = performance.now();
              const latency = Math.max(0.1, tRecv - tSend);
              rawLatencies.push(Number(latency.toFixed(2)));
              pendingClientIds.delete(c.userId);

              if (pendingClientIds.size === 0) {
                cleanup();
                resolve();
              }
            }
          });
          unsubs.push(unsub);
        }

        // Dispatch command
        if (action === "play") sender.sendPlay(param);
        else if (action === "pause") sender.sendPause(param);
        else sender.sendSeek(param ?? 10000);
      });
    };

    // 5. Execute command sequence (Play -> Seek -> Pause -> Play)
    await trackCommand("play", host, 0);
    await new Promise((r) => setTimeout(r, 300));

    // Sample drift during playback
    for (const c of clients) {
      rawDrifts.push(Math.abs(c.sampleDrift().driftMs));
    }

    const randomMember = clients[clients.length > 1 ? 1 : 0];
    await trackCommand("seek", randomMember, 45000);
    await new Promise((r) => setTimeout(r, 300));

    for (const c of clients) {
      rawDrifts.push(Math.abs(c.sampleDrift().driftMs));
    }

    await trackCommand("pause", host, 45300);
    await new Promise((r) => setTimeout(r, 200));

    for (const c of clients) {
      rawDrifts.push(Math.abs(c.sampleDrift().driftMs));
    }

    await trackCommand("play", host);
    await new Promise((r) => setTimeout(r, 400));

    for (const c of clients) {
      rawDrifts.push(Math.abs(c.sampleDrift().driftMs));
    }
  } finally {
    // Teardown
    for (const c of clients) {
      c.destroy();
    }
    await server.stop();
  }

  const latencyStats = computeDistributionStats(rawLatencies);
  const driftStats = computeDistributionStats(rawDrifts);

  const passLatency = latencyStats.p95 <= 250;
  const passDrift = driftStats.max <= 500;
  const status = passLatency && passDrift ? "PASS" : "FAIL";

  return {
    result: {
      scenarioName: `Scalability (N=${clientCount})`,
      description: `Baseline steady-state room with ${clientCount} concurrent headless WebSocket clients`,
      clientCount,
      durationSeconds: 2.5,
      latencyStats,
      driftStats,
      passLatency,
      passDrift,
      status,
      notes: `Propagated 4 state commands across ${clientCount} nodes. p95 latency: ${latencyStats.p95}ms, max drift: ${driftStats.max}ms.`,
    },
    rawLatencies,
  };
}
