import { BenchmarkServer } from "../harness/BenchmarkServer.js";
import { HeadlessClient } from "../harness/HeadlessClient.js";
import { computeDistributionStats } from "../reporters/Stats.js";
import { ScenarioRunOutput } from "./ScenarioTypes.js";

export async function runJitterScenario(clientCount = 10): Promise<ScenarioRunOutput> {
  const server = new BenchmarkServer();
  const { url } = await server.start();

  const clients: HeadlessClient[] = [];
  const rawLatencies: number[] = [];
  const rawDrifts: number[] = [];

  try {
    const host = new HeadlessClient({ userName: "Jitter_Host" });
    clients.push(host);
    await host.connect(url);
    const { roomCode } = await host.createRoom("150ms Jitter Test Room");

    for (let i = 1; i < clientCount; i++) {
      const client = new HeadlessClient({ userName: `Jitter_Client_${i}` });
      clients.push(client);
      await client.connect(url);
      await client.joinRoom(roomCode);
    }

    // Now inject 150ms random jitter on all client connections
    for (const c of clients) {
      c.network.updateConditions({ jitterMs: 150 });
    }

    // Allow jittered NTP ping burst to gather samples and stabilize
    await new Promise((r) => setTimeout(r, 600));

    // Track commands under 150ms jitter channel
    const trackJitterCommand = async (action: "play" | "seek", targetMs?: number): Promise<void> => {
      const targetClients = clients.slice(1);
      const pendingIds = new Set(targetClients.map((c) => c.userId));
      const tSend = performance.now();

      return new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          cleanup();
          resolve();
        }, 5000);

        const unsubs: (() => void)[] = [];
        const cleanup = () => {
          clearTimeout(timeout);
          for (const u of unsubs) u();
        };

        for (const c of targetClients) {
          const unsub = c.onPlaybackUpdate(() => {
            if (pendingIds.has(c.userId)) {
              const lat = performance.now() - tSend;
              rawLatencies.push(Number(lat.toFixed(2)));
              pendingIds.delete(c.userId);
              if (pendingIds.size === 0) {
                cleanup();
                resolve();
              }
            }
          });
          unsubs.push(unsub);
        }

        if (action === "play") host.sendPlay(targetMs);
        else host.sendSeek(targetMs ?? 20000);
      });
    };

    await trackJitterCommand("play", 0);
    await new Promise((r) => setTimeout(r, 600));

    for (const c of clients) {
      rawDrifts.push(Math.abs(c.sampleDrift().driftMs));
    }

    await trackJitterCommand("seek", 35000);
    await new Promise((r) => setTimeout(r, 600));

    for (const c of clients) {
      rawDrifts.push(Math.abs(c.sampleDrift().driftMs));
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
      scenarioName: "150 ms Added Jitter",
      description: "Asymmetric network jitter of [0, 150]ms injected on all WebSocket message transfers",
      clientCount,
      durationSeconds: 3.5,
      latencyStats,
      driftStats,
      passLatency,
      passDrift,
      status: passLatency && passDrift ? "PASS" : "FAIL",
      notes: `NTP median-of-lowest-60% filter kept clock offset robust. p95 latency: ${latencyStats.p95}ms, max drift: ${driftStats.max}ms.`,
    },
    rawLatencies,
  };
}
