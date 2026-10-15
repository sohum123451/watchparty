import {
  RelativeReadingPosition,
  SharedHighlight,
  StickyComment,
  MemberReadingPresence,
  SectionPing,
  CoBrowseMediaState,
  CoBrowseSession,
} from "@watchparty/shared";
import { CoBrowseOptions } from "./CoBrowseTypes.js";

export class CoBrowseManager {
  private url = "";
  private title = "";
  private frameAllowed = false;
  private isHost = false;
  private followHost = true;

  private hostPosition?: RelativeReadingPosition;
  private activeMedia?: CoBrowseMediaState;
  private readonly highlights = new Map<string, SharedHighlight>();
  private readonly comments = new Map<string, StickyComment>();
  private readonly presence = new Map<string, MemberReadingPresence>();
  private sharedNotes = "";
  private notesVersion = 1;
  private readonly sectionPings: SectionPing[] = [];

  private readonly options: CoBrowseOptions;

  constructor(options: CoBrowseOptions = {}) {
    this.options = options;
    this.url = options.url || "";
    this.title = options.title || "";
    this.frameAllowed = options.frameAllowed ?? false;
    this.isHost = options.isHost ?? false;
  }

  // ==========================================
  // FOLLOW HOST TOGGLE & SCROLL
  // ==========================================

  public setFollowHost(follow: boolean): void {
    if (this.followHost === follow) return;
    this.followHost = follow;
    this.options.onFollowHostChange?.(follow);
  }

  public isFollowingHost(): boolean {
    return this.followHost;
  }

  public setHost(isHost: boolean): void {
    this.isHost = isHost;
  }

  public getIsHost(): boolean {
    return this.isHost;
  }

  public getHostPosition(): RelativeReadingPosition | undefined {
    return this.hostPosition;
  }

  public applyHostScroll(position: RelativeReadingPosition): void {
    this.hostPosition = position;
    if (this.followHost) {
      this.options.onScrollChange?.(position);
    }
  }

  public broadcastLocalScroll(position: RelativeReadingPosition): void {
    if (this.isHost) {
      this.hostPosition = position;
    }
    this.options.onScrollChange?.(position);
  }

  // ==========================================
  // HIGHLIGHTS & STICKY COMMENTS
  // ==========================================

  public addHighlight(highlight: SharedHighlight): void {
    this.highlights.set(highlight.id, highlight);
    this.options.onHighlightAdd?.(highlight);
  }

  public removeHighlight(id: string): void {
    if (this.highlights.delete(id)) {
      this.options.onHighlightRemove?.(id);
    }
  }

  public getHighlights(): SharedHighlight[] {
    return Array.from(this.highlights.values()).sort((a, b) => a.createdAt - b.createdAt);
  }

  public addStickyComment(comment: StickyComment): void {
    this.comments.set(comment.id, comment);
    this.options.onCommentAdd?.(comment);
  }

  public deleteStickyComment(id: string): boolean {
    return this.comments.delete(id);
  }

  public getStickyComments(): StickyComment[] {
    return Array.from(this.comments.values()).sort((a, b) => a.createdAt - b.createdAt);
  }

  // ==========================================
  // PRESENCE CURSORS & SECTION PINGS
  // ==========================================

  public updatePresence(presence: MemberReadingPresence): void {
    this.presence.set(presence.userId, presence);
    this.options.onPresenceUpdate?.(presence);
  }

  public removePresence(userId: string): void {
    this.presence.delete(userId);
  }

  public getPresenceList(): MemberReadingPresence[] {
    return Array.from(this.presence.values());
  }

  public postSectionPing(
    sectionTitle: string,
    anchorSelector: string,
    user: { userId: string; userName: string }
  ): SectionPing {
    const ping: SectionPing = {
      id: `ping_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      userId: user.userId,
      userName: user.userName,
      sectionTitle,
      anchorSelector,
      timestamp: Date.now(),
    };

    this.sectionPings.unshift(ping);
    if (this.sectionPings.length > 50) {
      this.sectionPings.pop();
    }

    this.options.onSectionPing?.(ping);
    return ping;
  }

  public getSectionPings(): SectionPing[] {
    return [...this.sectionPings];
  }

  // ==========================================
  // SHARED NOTES DOCUMENT
  // ==========================================

  public updateNotes(text: string, version?: number): void {
    this.sharedNotes = text;
    this.notesVersion = typeof version === "number" ? version : this.notesVersion + 1;
    this.options.onNotesUpdate?.(this.sharedNotes, this.notesVersion);
  }

  public getSharedNotes(): { text: string; version: number } {
    return {
      text: this.sharedNotes,
      version: this.notesVersion,
    };
  }

  // ==========================================
  // EMBEDDED MEDIA SYNC
  // ==========================================

  public updateMediaSync(state: CoBrowseMediaState): void {
    this.activeMedia = state;
    this.options.onMediaSync?.(state);
  }

  public getActiveMedia(): CoBrowseMediaState | undefined {
    return this.activeMedia;
  }

  // ==========================================
  // SESSION SNAPSHOT
  // ==========================================

  public setSession(session: Partial<CoBrowseSession>): void {
    if (session.url) this.url = session.url;
    if (session.title) this.title = session.title;
    if (typeof session.frameAllowed === "boolean") this.frameAllowed = session.frameAllowed;
    if (session.hostReadingPosition) this.hostPosition = session.hostReadingPosition;
    if (session.activeMedia) this.activeMedia = session.activeMedia;

    if (session.highlights) {
      this.highlights.clear();
      for (const h of session.highlights) this.highlights.set(h.id, h);
    }

    if (session.stickyComments) {
      this.comments.clear();
      for (const c of session.stickyComments) this.comments.set(c.id, c);
    }

    if (session.presence) {
      this.presence.clear();
      for (const [uid, p] of Object.entries(session.presence)) this.presence.set(uid, p);
    }

    if (session.sharedNotes !== undefined) {
      this.sharedNotes = session.sharedNotes;
      this.notesVersion = session.notesVersion || 1;
    }

    if (session.sectionPings) {
      this.sectionPings.length = 0;
      this.sectionPings.push(...session.sectionPings);
    }
  }

  public getSession(): CoBrowseSession {
    const presenceObj: Record<string, MemberReadingPresence> = {};
    for (const [uid, p] of this.presence.entries()) {
      presenceObj[uid] = p;
    }

    return {
      url: this.url,
      title: this.title,
      frameAllowed: this.frameAllowed,
      hostReadingPosition: this.hostPosition,
      activeMedia: this.activeMedia,
      highlights: this.getHighlights(),
      stickyComments: this.getStickyComments(),
      presence: presenceObj,
      sharedNotes: this.sharedNotes,
      notesVersion: this.notesVersion,
      sectionPings: this.getSectionPings(),
    };
  }

  public getUrl(): string {
    return this.url;
  }

  public getTitle(): string {
    return this.title;
  }

  public isFramingAllowed(): boolean {
    return this.frameAllowed;
  }
}
