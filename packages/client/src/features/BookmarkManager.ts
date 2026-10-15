import { MomentBookmark, sanitizeText } from "@watchparty/shared";

export interface BookmarkReachedListener {
  (bookmark: MomentBookmark): void;
}

export interface BookmarkListListener {
  (bookmarks: MomentBookmark[]): void;
}

export interface BookmarkActionHandlers {
  onAdd?: (videoId: string, timestampMs: number, text: string, color?: string) => Promise<boolean> | boolean;
  onRemove?: (bookmarkId: string) => Promise<boolean> | boolean;
  onSeek?: (timestampMs: number) => void;
}

export class BookmarkManager {
  private bookmarks: MomentBookmark[] = [];
  private listListeners: Set<BookmarkListListener> = new Set();
  private reachedListeners: Set<BookmarkReachedListener> = new Set();
  private triggeredBookmarkIds: Set<string> = new Set();
  private lastCheckedTimeMs = 0;
  private handlers: BookmarkActionHandlers;

  constructor(options?: {
    initialBookmarks?: MomentBookmark[];
    handlers?: BookmarkActionHandlers;
  }) {
    if (options?.initialBookmarks) {
      this.initBookmarks(options.initialBookmarks);
    }
    this.handlers = options?.handlers || {};
  }

  public initBookmarks(bookmarks: MomentBookmark[]): void {
    this.bookmarks = [...bookmarks].sort((a, b) => a.timestampMs - b.timestampMs);
    this.notifyList();
  }

  public getBookmarks(): MomentBookmark[] {
    return [...this.bookmarks];
  }

  public async addBookmark(
    videoId: string,
    timestampMs: number,
    text: string,
    color?: string
  ): Promise<{ success: boolean; error?: string }> {
    const trimmed = text.trim();
    if (!trimmed) {
      return { success: false, error: "Note text cannot be empty" };
    }

    if (this.handlers.onAdd) {
      const ok = await this.handlers.onAdd(videoId, timestampMs, trimmed, color);
      return { success: Boolean(ok) };
    }
    return { success: true };
  }

  public async removeBookmark(bookmarkId: string): Promise<boolean> {
    if (this.handlers.onRemove) {
      return Boolean(await this.handlers.onRemove(bookmarkId));
    }
    return true;
  }

  public jumpToBookmark(bookmark: MomentBookmark): void {
    if (this.handlers.onSeek) {
      this.handlers.onSeek(bookmark.timestampMs);
    }
  }

  /**
   * Called during playback drift loop / time update.
   * Checks if video playback has crossed a bookmark timestamp, surfacing it as a live callout.
   */
  public checkPlaybackCrossing(currentTimeMs: number): MomentBookmark[] {
    // If user sought backward by > 2 seconds, clear triggered set so bookmarks can re-surface
    if (currentTimeMs < this.lastCheckedTimeMs - 2000) {
      this.triggeredBookmarkIds.clear();
    }

    const newlyReached: MomentBookmark[] = [];
    const windowStart = Math.min(this.lastCheckedTimeMs, currentTimeMs);
    const windowEnd = Math.max(this.lastCheckedTimeMs, currentTimeMs);

    for (const b of this.bookmarks) {
      // Check if bookmark falls in the interval [lastCheckedTimeMs, currentTimeMs]
      // Or within a 1.5s tolerance
      const inInterval = b.timestampMs >= windowStart && b.timestampMs <= windowEnd;
      const nearCurrent = Math.abs(b.timestampMs - currentTimeMs) <= 750;

      if ((inInterval || nearCurrent) && !this.triggeredBookmarkIds.has(b.id)) {
        this.triggeredBookmarkIds.add(b.id);
        newlyReached.push(b);
        for (const listener of this.reachedListeners) {
          listener(b);
        }
      }
    }

    this.lastCheckedTimeMs = currentTimeMs;
    return newlyReached;
  }

  public subscribeList(listener: BookmarkListListener): () => void {
    this.listListeners.add(listener);
    listener([...this.bookmarks]);
    return () => this.listListeners.delete(listener);
  }

  public subscribeReached(listener: BookmarkReachedListener): () => void {
    this.reachedListeners.add(listener);
    return () => this.reachedListeners.delete(listener);
  }

  private notifyList(): void {
    const list = [...this.bookmarks];
    for (const listener of this.listListeners) {
      listener(list);
    }
  }

  public destroy(): void {
    this.listListeners.clear();
    this.reachedListeners.clear();
    this.triggeredBookmarkIds.clear();
  }
}
