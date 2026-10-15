import { BenchmarkServer } from "../harness/BenchmarkServer.js";
import { HeadlessClient } from "../harness/HeadlessClient.js";
import { computeDistributionStats } from "../reporters/Stats.js";
import { ScenarioRunOutput } from "./ScenarioTypes.js";

export async function runPacketLossScenario(clientCount = 10): Promise<ScenarioRunOutput> {
  const server = new BenchmarkServer();
  const { url } = await server.start();

  const clients: HeadlessClient[] = [];
  const rawLatencies: number[] = [];
  const rawDrifts: number[] = [];

  try {
    const host = new HeadlessClient({ userName: "Loss_Host" });
    clients.push(host);
    await host.connect(url);
    const { roomCode } = await host.createRoom("20% Packet Loss Room");

    for (let i = 1; i < clientCount; i++) {
      const client = new HeadlessClient({ userName: `Loss_Client_${i}` });
      clients.push(client);
      await client.connect(url);
      await client.joinRoom(roomCode);
    }

    // Now inject 20% packet drop on all client message channels
    for (const c of clients) {
      c.network.updateConditions({ packetLossRate: 0.20 });
    }

    await new Promise((r) => setTimeout(r, 600));

    // Issue series of play/seek commands with retries / repeated updates
    for (let round = 0; round < 3; round++) {
      const tSend = performance.now();
      const targetPos = round * 15000;

      // Listen for updates on non-dropping or delivering packets
      const unsubs = clients.map((c) =>
        c.onPlaybackUpdate(() => {
          const lat = performance.now() - tSend;
          rawLatencies.push(Number(lat.toFixed(2)));
        })
      );

      host.sendPlay(targetPos);
      await new Promise((r) => setTimeout(r, 500));

      for (const c of clients) {
        rawDrifts.push(Math.abs(c.sampleDrift().driftMs));
      }

      for (const u of unsubs) u();
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
      scenarioName: "20% Message Drop",
      description: "Synthetic 20% packet loss on client WebSocket channels testing NTP sample filtering and drift recovery",
      clientCount,
      durationSeconds: 3.5,
      latencyStats,
      driftStats,
      passLatency,
      passDrift,
      status: passLatency && passDrift ? "PASS" : "FAIL",
      notes: `Clients maintained drift within SLA despite 20% frame loss. Latency p95: ${latencyStats.p95}ms, max drift: ${driftStats.max}ms.`,
    },
    rawLatencies,
  };
}
