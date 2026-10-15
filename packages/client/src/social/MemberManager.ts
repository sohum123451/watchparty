import { MemberPublicInfo, ParticipantMediaState } from "@watchparty/shared";

export interface MemberListListener {
  (members: MemberPublicInfo[]): void;
}

export class MemberManager {
  private members: Map<string, MemberPublicInfo> = new Map();
  private hostId = "";
  private selfUserId = "";
  private listeners: Set<MemberListListener> = new Set();

  constructor(options?: {
    initialMembers?: MemberPublicInfo[];
    hostId?: string;
    selfUserId?: string;
  }) {
    if (options?.hostId) {
      this.hostId = options.hostId;
    }
    if (options?.selfUserId) {
      this.selfUserId = options.selfUserId;
    }
    if (options?.initialMembers) {
      this.initMembers(options.initialMembers, options.hostId ?? "");
    }
  }

  public initMembers(members: MemberPublicInfo[], hostId: string, selfUserId?: string): void {
    this.members.clear();
    this.hostId = hostId;
    if (selfUserId) {
      this.selfUserId = selfUserId;
    }

    for (const m of members) {
      this.members.set(m.userId, {
        ...m,
        isHost: m.userId === hostId || m.isHost,
      });
    }

    this.notify();
  }

  public handleMemberJoined(member: MemberPublicInfo): void {
    this.members.set(member.userId, {
      ...member,
      isHost: member.userId === this.hostId || member.isHost,
    });
    this.notify();
  }

  public handleMemberLeft(userId: string, newHostId?: string): void {
    this.members.delete(userId);
    if (newHostId) {
      this.hostId = newHostId;
      for (const m of this.members.values()) {
        m.isHost = m.userId === newHostId;
      }
    }
    this.notify();
  }

  public handleMemberStatus(userId: string, isConnected: boolean): void {
    const member = this.members.get(userId);
    if (member) {
      member.isConnected = isConnected;
      this.notify();
    }
  }

  public handleHostChanged(newHostId: string): void {
    this.hostId = newHostId;
    for (const m of this.members.values()) {
      m.isHost = m.userId === newHostId;
    }
    this.notify();
  }

  public handleBufferReport(userId: string, isBuffering: boolean): void {
    const member = this.members.get(userId);
    if (member) {
      member.isBuffering = isBuffering;
      this.notify();
    }
  }

  /**
   * Sync voice presence, speaking indicators, and mute states across the member list
   */
  public handleVoiceStateUpdated(participants: ParticipantMediaState[]): void {
    const map = new Map(participants.map((p) => [p.userId, p]));

    for (const [userId, member] of this.members.entries()) {
      const vp = map.get(userId);
      if (vp && vp.inVoice) {
        member.inVoice = true;
        member.isSpeaking = vp.isSpeaking;
        member.voiceMuted = vp.audioMuted;
        member.videoEnabled = vp.videoEnabled;
      } else {
        member.inVoice = false;
        member.isSpeaking = false;
        member.voiceMuted = false;
        member.videoEnabled = false;
      }
    }
    this.notify();
  }

  public getMembers(): MemberPublicInfo[] {
    return Array.from(this.members.values()).sort((a, b) => {
      // Host always first, then connected, then by joinedAt
      if (a.isHost !== b.isHost) return a.isHost ? -1 : 1;
      if (a.isConnected !== b.isConnected) return a.isConnected ? -1 : 1;
      return a.joinedAt - b.joinedAt;
    });
  }

  public getMember(userId: string): MemberPublicInfo | undefined {
    return this.members.get(userId);
  }

  public getHost(): MemberPublicInfo | undefined {
    return this.members.get(this.hostId);
  }

  public getSelf(): MemberPublicInfo | undefined {
    return this.members.get(this.selfUserId);
  }

  public isSelfHost(): boolean {
    return this.selfUserId === this.hostId;
  }

  public getBufferingMembers(): MemberPublicInfo[] {
    return Array.from(this.members.values()).filter((m) => m.isConnected && m.isBuffering);
  }

  public getVoiceMembers(): MemberPublicInfo[] {
    return Array.from(this.members.values()).filter((m) => m.isConnected && m.inVoice);
  }

  public getSpeakingMembers(): MemberPublicInfo[] {
    return Array.from(this.members.values()).filter((m) => m.isConnected && m.inVoice && m.isSpeaking);
  }

  public getMutedMembers(): MemberPublicInfo[] {
    return Array.from(this.members.values()).filter((m) => m.isConnected && (m.isMuted || (m.inVoice && m.voiceMuted)));
  }

  public subscribe(listener: MemberListListener): () => void {
    this.listeners.add(listener);
    listener(this.getMembers());
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    const list = this.getMembers();
    for (const listener of this.listeners) {
      listener(list);
    }
  }

  public destroy(): void {
    this.members.clear();
    this.listeners.clear();
  }
}
