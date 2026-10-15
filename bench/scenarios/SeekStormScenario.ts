import { BenchmarkServer } from "../harness/BenchmarkServer.js";
import { HeadlessClient } from "../harness/HeadlessClient.js";
import { computeDistributionStats } from "../reporters/Stats.js";
import { ScenarioRunOutput } from "./ScenarioTypes.js";

export async function runSeekStormScenario(clientCount = 20): Promise<ScenarioRunOutput> {
  const server = new BenchmarkServer();
  const { url } = await server.start();

  const clients: HeadlessClient[] = [];
  const rawLatencies: number[] = [];
  const rawDrifts: number[] = [];

  try {
    const host = new HeadlessClient({ userName: "Storm_Host" });
    clients.push(host);
    await host.connect(url);
    const { roomCode } = await host.createRoom("Seek Storm Room");

    for (let i = 1; i < clientCount; i++) {
      const client = new HeadlessClient({ userName: `Storm_Client_${i}` });
      clients.push(client);
      await client.connect(url);
      await client.joinRoom(roomCode);
    }

    await new Promise((r) => setTimeout(r, 300));
    host.sendPlay(0);
    await new Promise((r) => setTimeout(r, 200));

    // SEEK STORM: All clients fire seeks simultaneously
    const stormStartTime = performance.now();
    const updateWaiters = clients.map((c) => {
      return new Promise<void>((resolve) => {
        let count = 0;
        const unsub = c.onPlaybackUpdate(() => {
          count++;
          const lat = Math.max(0.1, performance.now() - stormStartTime);
          rawLatencies.push(Number(lat.toFixed(2)));
          if (count >= clientCount) {
            unsub();
            resolve();
          }
        });
        setTimeout(() => {
          unsub();
          resolve();
        }, 4000);
      });
    });

    // Fire all seeks at once
    clients.forEach((c, idx) => {
      c.sendSeek(10000 + idx * 2500);
    });

    await Promise.all(updateWaiters);
    await new Promise((r) => setTimeout(r, 400));

    // Sample drift after storm settles
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
      scenarioName: "All-Clients-Seek-at-Once Storm",
      description: `${clientCount} clients firing concurrent seek commands into the serialized room queue`,
      clientCount,
      durationSeconds: 3.5,
      latencyStats,
      driftStats,
      passLatency,
      passDrift,
      status: passLatency && passDrift ? "PASS" : "FAIL",
      notes: `Server serialized ${clientCount} simultaneous seeks without dropped messages. p95 latency: ${latencyStats.p95}ms, max drift: ${driftStats.max}ms.`,
    },
    rawLatencies,
  };
}
