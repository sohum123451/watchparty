import { ClientMessage, ServerMessage, ChaosConfig } from "@watchparty/shared";

export interface ChaosStats {
  injectedLatencyMs: number;
  packetsDropped: number;
  packetsDelayed: number;
  forcedDisconnects: number;
  isEnabled: boolean;
}

export interface ChaosListener {
  (stats: ChaosStats): void;
}

export class ChaosSimulator {
  private config: ChaosConfig;
  private stats: ChaosStats = {
    injectedLatencyMs: 0,
    packetsDropped: 0,
    packetsDelayed: 0,
    forcedDisconnects: 0,
    isEnabled: false,
  };
  private disconnectTimer: any = null;
  private listeners: Set<ChaosListener> = new Set();
  private onTriggerDisconnect?: () => void;

  constructor(options?: {
    initialConfig?: Partial<ChaosConfig>;
    onTriggerDisconnect?: () => void;
  }) {
    this.config = {
      enabled: options?.initialConfig?.enabled ?? false,
      latencyMs: options?.initialConfig?.latencyMs ?? 250,
      jitterMs: options?.initialConfig?.jitterMs ?? 100,
      packetLossRate: options?.initialConfig?.packetLossRate ?? 0.15, // 15% drop rate
      disconnectIntervalMs: options?.initialConfig?.disconnectIntervalMs,
    };
    this.stats.isEnabled = this.config.enabled;
    this.onTriggerDisconnect = options?.onTriggerDisconnect;

    if (this.config.enabled) {
      this.setupDisconnectInterval();
    }
  }

  public enable(customConfig?: Partial<ChaosConfig>): void {
    this.config = {
      ...this.config,
      ...customConfig,
      enabled: true,
    };
    this.stats.isEnabled = true;
    this.setupDisconnectInterval();
    this.notify();
  }

  public disable(): void {
    this.config.enabled = false;
    this.stats.isEnabled = false;
    if (this.disconnectTimer) {
      clearInterval(this.disconnectTimer);
      this.disconnectTimer = null;
    }
    this.notify();
  }

  public toggle(): boolean {
    if (this.config.enabled) {
      this.disable();
    } else {
      this.enable();
    }
    return this.config.enabled;
  }

  public getConfig(): ChaosConfig {
    return { ...this.config };
  }

  public getStats(): ChaosStats {
    return { ...this.stats };
  }

  /**
   * Intercepts outgoing WebSocket messages and applies packet loss, latency, and jitter.
   */
  public interceptOutgoing(
    message: ClientMessage,
    realSend: (msg: ClientMessage) => void
  ): boolean {
    if (!this.config.enabled) {
      realSend(message);
      return true;
    }

    // Packet loss check
    if (Math.random() < this.config.packetLossRate) {
      this.stats.packetsDropped++;
      this.notify();
      return false; // Dropped packet!
    }

    // Latency + jitter injection
    const jitter = (Math.random() * 2 - 1) * this.config.jitterMs;
    const delayMs = Math.max(0, Math.round(this.config.latencyMs + jitter));

    this.stats.injectedLatencyMs = delayMs;
    this.stats.packetsDelayed++;
    this.notify();

    setTimeout(() => {
      realSend(message);
    }, delayMs);

    return true;
  }

  /**
   * Intercepts incoming WebSocket messages and applies simulated network chaos.
   */
  public interceptIncoming(
    message: ServerMessage,
    realReceive: (msg: ServerMessage) => void
  ): boolean {
    if (!this.config.enabled) {
      realReceive(message);
      return true;
    }

    // Packet loss check
    if (Math.random() < this.config.packetLossRate) {
      this.stats.packetsDropped++;
      this.notify();
      return false; // Dropped!
    }

    // Latency + jitter injection
    const jitter = (Math.random() * 2 - 1) * this.config.jitterMs;
    const delayMs = Math.max(0, Math.round(this.config.latencyMs + jitter));

    this.stats.injectedLatencyMs = delayMs;
    this.stats.packetsDelayed++;
    this.notify();

    setTimeout(() => {
      realReceive(message);
    }, delayMs);

    return true;
  }

  private setupDisconnectInterval(): void {
    if (this.disconnectTimer) {
      clearInterval(this.disconnectTimer);
      this.disconnectTimer = null;
    }

    if (this.config.disconnectIntervalMs && this.config.disconnectIntervalMs > 0) {
      this.disconnectTimer = setInterval(() => {
        if (this.config.enabled && this.onTriggerDisconnect) {
          this.stats.forcedDisconnects++;
          this.notify();
          this.onTriggerDisconnect();
        }
      }, this.config.disconnectIntervalMs);
    }
  }

  public subscribe(listener: ChaosListener): () => void {
    this.listeners.add(listener);
    listener({ ...this.stats });
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    const s = { ...this.stats };
    for (const listener of this.listeners) {
      listener(s);
    }
  }

  public destroy(): void {
    this.disable();
    this.listeners.clear();
  }
}
