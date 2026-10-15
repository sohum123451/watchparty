import { PollSummary } from "@watchparty/shared";

export interface PollStateListener {
  (poll: PollSummary | null): void;
}

export interface PollActionHandlers {
  onCreatePoll?: (
    question: string,
    options: string[],
    durationSeconds?: number,
    autoQueueWinner?: boolean
  ) => Promise<boolean> | boolean;
  onVote?: (pollId: string, optionIndex: number) => Promise<boolean> | boolean;
}

export class PollManager {
  private activePoll: PollSummary | null = null;
  private listeners: Set<PollStateListener> = new Set();
  private handlers: PollActionHandlers;
  private expirationTimer: any = null;
  private remainingTimeMs = 0;

  constructor(options?: {
    initialPoll?: PollSummary | null;
    handlers?: PollActionHandlers;
  }) {
    if (options?.initialPoll) {
      this.initPoll(options.initialPoll);
    }
    this.handlers = options?.handlers || {};
  }

  public initPoll(poll: PollSummary | null): void {
    this.activePoll = poll ? { ...poll } : null;
    this.setupExpirationTimer();
    this.notify();
  }

  public handlePollUpdate(poll: PollSummary | null): void {
    this.activePoll = poll ? { ...poll } : null;
    this.setupExpirationTimer();
    this.notify();
  }

  public getActivePoll(): PollSummary | null {
    return this.activePoll ? { ...this.activePoll } : null;
  }

  public getRemainingTimeMs(serverNow: number): number {
    if (!this.activePoll || this.activePoll.isClosed) return 0;
    return Math.max(0, this.activePoll.expiresAtServerTimeMs - serverNow);
  }

  /**
   * Vote on an option with optimistic local tallying.
   * A user can change their vote any time before poll closes.
   */
  public async vote(optionIndex: number): Promise<{ success: boolean; error?: string }> {
    if (!this.activePoll) {
      return { success: false, error: "No active poll" };
    }
    if (this.activePoll.isClosed) {
      return { success: false, error: "Poll is closed" };
    }
    if (optionIndex < 0 || optionIndex >= this.activePoll.options.length) {
      return { success: false, error: "Invalid option selected" };
    }

    const pollId = this.activePoll.id;
    const targetOption = this.activePoll.options[optionIndex];
    const previousVoteId = this.activePoll.userVotedOptionId;

    // Optimistic vote update
    const previousSnapshot = JSON.parse(JSON.stringify(this.activePoll)) as PollSummary;

    if (previousVoteId !== targetOption.id) {
      if (previousVoteId) {
        const prevOpt = this.activePoll.options.find((o) => o.id === previousVoteId);
        if (prevOpt && prevOpt.votes > 0) prevOpt.votes--;
      }
      targetOption.votes++;
      this.activePoll.userVotedOptionId = targetOption.id;
      this.notify();
    }

    if (this.handlers.onVote) {
      try {
        const ok = await this.handlers.onVote(pollId, optionIndex);
        if (!ok) {
          this.activePoll = previousSnapshot;
          this.notify();
          return { success: false, error: "Vote rejected by server" };
        }
      } catch (err) {
        this.activePoll = previousSnapshot;
        this.notify();
        return { success: false, error: String(err) };
      }
    }

    return { success: true };
  }

  /**
   * Create a new group poll with options and optional auto-queue.
   */
  public async createPoll(
    question: string,
    options: string[],
    durationSeconds = 30,
    autoQueueWinner = false
  ): Promise<{ success: boolean; error?: string }> {
    const trimmedQ = question.trim();
    const cleanOpts = options.map((o) => o.trim()).filter(Boolean);

    if (!trimmedQ) {
      return { success: false, error: "Poll question cannot be empty" };
    }
    if (cleanOpts.length < 2) {
      return { success: false, error: "Poll must have at least 2 options" };
    }

    if (this.handlers.onCreatePoll) {
      const ok = await this.handlers.onCreatePoll(trimmedQ, cleanOpts, durationSeconds, autoQueueWinner);
      return { success: Boolean(ok) };
    }

    return { success: true };
  }

  private setupExpirationTimer(): void {
    if (this.expirationTimer) {
      clearTimeout(this.expirationTimer);
      this.expirationTimer = null;
    }

    if (!this.activePoll || this.activePoll.isClosed) {
      return;
    }

    const remaining = Math.max(0, this.activePoll.expiresAtServerTimeMs - Date.now());
    this.expirationTimer = setTimeout(() => {
      if (this.activePoll && !this.activePoll.isClosed) {
        this.activePoll.isClosed = true;
        this.notify();
      }
    }, remaining);
  }

  public subscribe(listener: PollStateListener): () => void {
    this.listeners.add(listener);
    listener(this.activePoll ? { ...this.activePoll } : null);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    const snapshot = this.activePoll ? { ...this.activePoll } : null;
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  public destroy(): void {
    if (this.expirationTimer) {
      clearTimeout(this.expirationTimer);
    }
    this.listeners.clear();
  }
}
