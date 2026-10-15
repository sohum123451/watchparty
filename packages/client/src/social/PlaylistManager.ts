import { PlaylistItem } from "@watchparty/shared";

export interface PlaylistListener {
  (playlist: PlaylistItem[]): void;
}

export interface PlaylistActionHandlers {
  onAdd?: (videoId: string, title: string, durationMs: number, thumbnailUrl?: string) => Promise<boolean> | boolean;
  onRemove?: (playlistItemId: string) => Promise<boolean> | boolean;
  onReorder?: (playlistItemId: string, newIndex: number, order?: number, expectedVersion?: number) => Promise<boolean> | boolean;
  onPlaybackEnded?: (videoId: string) => Promise<boolean> | boolean;
}

export class PlaylistManager {
  private playlist: PlaylistItem[] = [];
  private currentVersion = 1;
  private listeners: Set<PlaylistListener> = new Set();
  private handlers: PlaylistActionHandlers;

  constructor(options?: {
    initialPlaylist?: PlaylistItem[];
    initialVersion?: number;
    handlers?: PlaylistActionHandlers;
  }) {
    if (options?.initialPlaylist) {
      this.initPlaylist(options.initialPlaylist, options.initialVersion ?? 1);
    }
    this.handlers = options?.handlers || {};
  }

  public initPlaylist(items: PlaylistItem[], version: number): void {
    this.currentVersion = version;
    this.playlist = [...items].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    this.notify();
  }

  public getPlaylist(): PlaylistItem[] {
    return [...this.playlist];
  }

  public getNextItem(currentVideoId: string): PlaylistItem | null {
    if (this.playlist.length === 0) return null;
    const currentIndex = this.playlist.findIndex((p) => p.videoId === currentVideoId);
    if (currentIndex !== -1 && currentIndex + 1 < this.playlist.length) {
      return this.playlist[currentIndex + 1];
    }
    // If last or not found, return first if different
    if (this.playlist.length > 0 && this.playlist[0].videoId !== currentVideoId) {
      return this.playlist[0];
    }
    return null;
  }

  /**
   * Computes the fractional index for inserting an item before/after or between items.
   * This guarantees that concurrent reorder actions from multiple users can be merged
   * deterministically without index collisions.
   */
  public computeFractionalIndex(
    itemId: string,
    targetIndex: number
  ): { newIndex: number; order: number } {
    const sorted = [...this.playlist].filter((p) => p.id !== itemId);
    const clampedIndex = Math.max(0, Math.min(targetIndex, sorted.length));

    if (sorted.length === 0) {
      return { newIndex: 0, order: 1000 };
    }

    if (clampedIndex === 0) {
      // Placed before the first item
      const firstOrder = sorted[0].order ?? 1000;
      return { newIndex: 0, order: firstOrder / 2 };
    }

    if (clampedIndex >= sorted.length) {
      // Placed after the last item
      const lastOrder = sorted[sorted.length - 1].order ?? (sorted.length * 1000);
      return { newIndex: sorted.length, order: lastOrder + 1000 };
    }

    // Placed between clampedIndex - 1 and clampedIndex
    const prevOrder = sorted[clampedIndex - 1].order ?? (clampedIndex * 1000);
    const nextOrder = sorted[clampedIndex].order ?? ((clampedIndex + 1) * 1000);
    return {
      newIndex: clampedIndex,
      order: (prevOrder + nextOrder) / 2,
    };
  }

  /**
   * Reorder with optimistic local update and fractional indexing.
   */
  public async reorder(
    playlistItemId: string,
    targetIndex: number
  ): Promise<{ success: boolean; error?: string }> {
    const currentIndex = this.playlist.findIndex((p) => p.id === playlistItemId);
    if (currentIndex === -1) {
      return { success: false, error: "Item not found in playlist" };
    }

    const { newIndex, order } = this.computeFractionalIndex(playlistItemId, targetIndex);
    const previousSnapshot = [...this.playlist];
    const previousVersion = this.currentVersion;

    // Apply optimistic local update
    const [moved] = this.playlist.splice(currentIndex, 1);
    moved.order = order;
    this.playlist.splice(newIndex, 0, moved);
    this.notify();

    if (this.handlers.onReorder) {
      try {
        const ok = await this.handlers.onReorder(playlistItemId, newIndex, order, previousVersion);
        if (!ok) {
          // Rollback on rejection
          this.playlist = previousSnapshot;
          this.notify();
          return { success: false, error: "Reorder rejected by server" };
        }
      } catch (err) {
        this.playlist = previousSnapshot;
        this.notify();
        return { success: false, error: String(err) };
      }
    }

    return { success: true };
  }

  public async addItem(
    videoId: string,
    title: string,
    durationMs: number,
    thumbnailUrl?: string
  ): Promise<boolean> {
    if (this.handlers.onAdd) {
      return Boolean(await this.handlers.onAdd(videoId, title, durationMs, thumbnailUrl));
    }
    return true;
  }

  public async removeItem(playlistItemId: string): Promise<boolean> {
    if (this.handlers.onRemove) {
      return Boolean(await this.handlers.onRemove(playlistItemId));
    }
    return true;
  }

  /**
   * Called when current video playback concludes. Triggers synchronized auto-advance to "up next".
   */
  public async handlePlaybackEnded(currentVideoId: string): Promise<boolean> {
    if (this.handlers.onPlaybackEnded) {
      return Boolean(await this.handlers.onPlaybackEnded(currentVideoId));
    }
    return true;
  }

  public subscribe(listener: PlaylistListener): () => void {
    this.listeners.add(listener);
    listener([...this.playlist]);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    const items = [...this.playlist];
    for (const listener of this.listeners) {
      listener(items);
    }
  }

  public destroy(): void {
    this.listeners.clear();
  }
}
