import http from "node:http";
import { RoomManager } from "@watchparty/server/src/rooms/RoomManager.js";
import { WebSocketGateway } from "@watchparty/server/src/gateway/WebSocketGateway.js";
import { MemoryRedisService } from "@watchparty/server/src/redis/RedisService.js";
import { RedisRoomAdapter } from "@watchparty/server/src/redis/RedisRoomAdapter.js";
import { AuthService, MemoryAuthRepository, ConsoleMailer } from "@watchparty/server/src/auth/index.js";
import { MetricsCollector } from "@watchparty/server/src/metrics/MetricsCollector.js";

export class BenchmarkServer {
  public server: http.Server | null = null;
  public gateway: WebSocketGateway | null = null;
  public roomManager: RoomManager | null = null;
  public redis: MemoryRedisService | null = null;
  public redisAdapter: RedisRoomAdapter | null = null;
  public authService: AuthService | null = null;
  public metricsCollector: MetricsCollector | null = null;
  public port = 0;
  public url = "";

  public async start(): Promise<{ port: number; url: string }> {
    this.roomManager = new RoomManager();
    this.server = http.createServer();

    // 1. Redis Persistence & Pub/Sub Adapter enabled
    this.redis = new MemoryRedisService();
    this.redisAdapter = new RedisRoomAdapter(this.redis, `bench_node_${Math.random().toString(36).substring(2, 7)}`);
    await this.redisAdapter.init();
    this.roomManager.setRedisAdapter(this.redisAdapter);

    // 2. Authentication Service enabled
    const authRepo = new MemoryAuthRepository();
    this.authService = new AuthService({
      repo: authRepo,
      mailer: new ConsoleMailer(),
      baseUrl: "http://localhost:3000",
    });

    // 3. Observability & Prometheus Metrics enabled
    this.metricsCollector = new MetricsCollector();

    this.gateway = new WebSocketGateway(this.server, this.roomManager, {
      authService: this.authService,
      metricsCollector: this.metricsCollector,
      redisAdapter: this.redisAdapter,
    });

    await new Promise<void>((resolve) => {
      this.server!.listen(0, () => {
        const addr = this.server!.address();
        if (addr && typeof addr === "object") {
          this.port = addr.port;
          this.url = `ws://localhost:${this.port}`;
          this.roomManager!.setBaseUrl(`http://localhost:${this.port}`);
        }
        resolve();
      });
    });

    return { port: this.port, url: this.url };
  }

  public async stop(): Promise<void> {
    if (this.gateway) {
      await this.gateway.drainAndClose();
      this.gateway = null;
    }
    if (this.redisAdapter) {
      await this.redisAdapter.disconnect();
      this.redisAdapter = null;
    }
    if (this.redis) {
      await this.redis.disconnect();
      this.redis = null;
    }
    if (this.roomManager) {
      this.roomManager.cleanupAll();
      this.roomManager = null;
    }
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
      });
      this.server = null;
    }
  }
}
