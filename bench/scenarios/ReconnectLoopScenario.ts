import { BenchmarkServer } from "../harness/BenchmarkServer.js";
import { HeadlessClient } from "../harness/HeadlessClient.js";
import { computeDistributionStats } from "../reporters/Stats.js";
import { ScenarioRunOutput } from "./ScenarioTypes.js";

export async function runReconnectLoopScenario(clientCount = 8): Promise<ScenarioRunOutput> {
  const server = new BenchmarkServer();
  const { url } = await server.start();

  const clients: HeadlessClient[] = [];
  const rawLatencies: number[] = [];
  const rawDrifts: number[] = [];

  try {
    const host = new HeadlessClient({ userName: "Loop_Host" });
    clients.push(host);
    await host.connect(url);
    const { roomCode } = await host.createRoom("Reconnect Loop Room");

    for (let i = 1; i < clientCount; i++) {
      const client = new HeadlessClient({ userName: `Cycler_${i}` });
      clients.push(client);
      await client.connect(url);
      await client.joinRoom(roomCode);
    }

    await new Promise((r) => setTimeout(r, 300));
    host.sendPlay(1000);
    await new Promise((r) => setTimeout(r, 400));

    // Select cycling clients to perform disconnect-reconnect loops
    const cyclers = clients.slice(1, 4);

    for (let cycle = 0; cycle < 2; cycle++) {
      // Disconnect
      await Promise.all(cyclers.map((c) => c.disconnect()));

      // Meanwhile host seeks while clients are disconnected to generate missed events
      host.sendSeek(20000 + cycle * 10000);
      await new Promise((r) => setTimeout(r, 400));

      // Reconnect
      for (const c of cyclers) {
        const tStart = performance.now();
        await c.reconnect(roomCode);
        const elapsed = performance.now() - tStart;
        rawLatencies.push(Number(elapsed.toFixed(2)));
      }

      await new Promise((r) => setTimeout(r, 400));

      // Sample drift across all clients post-reconnect
      for (const c of clients) {
        if (c.isConnected) {
          rawDrifts.push(Math.abs(c.sampleDrift().driftMs));
        }
      }
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
      scenarioName: "Reconnect Loop",
      description: "Subsets of clients repeatedly disconnecting, missing events, reconnecting via session tokens, and catching up",
      clientCount,
      durationSeconds: 3.5,
      latencyStats,
      driftStats,
      passLatency,
      passDrift,
      status: passLatency && passDrift ? "PASS" : "FAIL",
      notes: `Replayed missed events from VersionedRingBuffer. Post-reconnect p95 latency: ${latencyStats.p95}ms, max drift: ${driftStats.max}ms.`,
    },
    rawLatencies,
  };
}
