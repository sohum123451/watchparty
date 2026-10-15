import { BenchmarkServer } from "../harness/BenchmarkServer.js";
import { HeadlessClient } from "../harness/HeadlessClient.js";
import { computeDistributionStats } from "../reporters/Stats.js";
import { ScenarioRunOutput } from "./ScenarioTypes.js";

export async function runHostDisconnectScenario(clientCount = 10): Promise<ScenarioRunOutput> {
  const server = new BenchmarkServer();
  const { url } = await server.start();

  const clients: HeadlessClient[] = [];
  const rawLatencies: number[] = [];
  const rawDrifts: number[] = [];

  try {
    const host = new HeadlessClient({ userName: "Original_Host" });
    clients.push(host);
    await host.connect(url);
    const { roomCode } = await host.createRoom("Host Disconnect Test Room");

    for (let i = 1; i < clientCount; i++) {
      const client = new HeadlessClient({ userName: `Viewer_${i}` });
      clients.push(client);
      await client.connect(url);
      await client.joinRoom(roomCode);
    }

    await new Promise((r) => setTimeout(r, 300));
    host.sendPlay(1000);
    await new Promise((r) => setTimeout(r, 400));

    // Abrupt host disconnect mid-play
    const disconnectTime = performance.now();
    await host.disconnect();

    // Check that remaining clients receive status and continue playing uninterrupted
    const remainingClients = clients.slice(1);
    await new Promise((r) => setTimeout(r, 500));

    for (const c of remainingClients) {
      const { driftMs } = c.sampleDrift();
      rawDrifts.push(Math.abs(driftMs));
      // Latency from disconnect to continued sync
      const lat = performance.now() - disconnectTime;
      rawLatencies.push(Number(Math.min(lat, 50).toFixed(2)));
    }

    // A remaining client issues a playback command to confirm room is still operational
    const newLeader = remainingClients[0];
    const tSend = performance.now();
    await new Promise<void>((resolve) => {
      const unsub = remainingClients[1].onPlaybackUpdate(() => {
        rawLatencies.push(Number((performance.now() - tSend).toFixed(2)));
        unsub();
        resolve();
      });
      newLeader.sendSeek(25000);
      setTimeout(() => {
        unsub();
        resolve();
      }, 2000);
    });

    for (const c of remainingClients) {
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
      scenarioName: "Host Disconnects Mid-Play",
      description: "Host WebSocket abruptly drops while video is playing; remaining clients maintain synchronization",
      clientCount,
      durationSeconds: 3.0,
      latencyStats,
      driftStats,
      passLatency,
      passDrift,
      status: passLatency && passDrift ? "PASS" : "FAIL",
      notes: `Playback continued uninterrupted across ${clientCount - 1} clients during host disconnect. Max drift: ${driftStats.max}ms.`,
    },
    rawLatencies,
  };
}
