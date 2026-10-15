import {
  E2eeCrypto,
  MemberPublicInfo,
  ClientMessage,
  EncryptedChatPayload,
} from "@watchparty/shared";

export interface E2eeManagerOptions {
  wsSender?: (message: ClientMessage) => void;
  onFingerprintChange?: (fingerprint: string) => void;
  onKeyRotated?: (keyVersion: number) => void;
}

export class E2eeManager {
  private isEnabled = false;
  private keyVersion = 1;
  private memberKeyPair: CryptoKeyPair | null = null;
  private memberPublicKeyBase64: string | null = null;
  private roomKey: CryptoKey | null = null;
  private safetyFingerprint: string | null = null;
  private isHost = false;
  private selfUserId = "";
  private roomId = "";
  private membersProvider?: () => MemberPublicInfo[];

  private wsSender?: (message: ClientMessage) => void;
  private onFingerprintChange?: (fingerprint: string) => void;
  private onKeyRotatedCallback?: (keyVersion: number) => void;

  constructor(options?: E2eeManagerOptions) {
    this.wsSender = options?.wsSender;
    this.onFingerprintChange = options?.onFingerprintChange;
    this.onKeyRotatedCallback = options?.onKeyRotated;
  }

  public setSender(sender: (message: ClientMessage) => void): void {
    this.wsSender = sender;
  }

  public setMembersProvider(provider: () => MemberPublicInfo[]): void {
    this.membersProvider = provider;
  }

  public get enabled(): boolean {
    return this.isEnabled;
  }

  public get currentKeyVersion(): number {
    return this.keyVersion;
  }

  public getPublicKey(): string | null {
    return this.memberPublicKeyBase64;
  }

  public getSafetyFingerprint(): string | null {
    return this.safetyFingerprint;
  }

  public hasRoomKey(): boolean {
    return this.roomKey !== null;
  }

  /**
   * Initializes local WebCrypto ECDH P-256 keypair for this member session.
   */
  public async initializeMemberKeys(): Promise<string> {
    if (this.memberPublicKeyBase64) {
      return this.memberPublicKeyBase64;
    }
    const keyPair = await E2eeCrypto.generateMemberKeyPair();
    this.memberKeyPair = keyPair;
    this.memberPublicKeyBase64 = await E2eeCrypto.exportPublicKey(keyPair.publicKey);
    return this.memberPublicKeyBase64;
  }

  /**
   * Configures room state from snapshot or room creation.
   */
  public async handleRoomInit(params: {
    enabled: boolean;
    roomId?: string;
    keyVersion?: number;
    isHost: boolean;
    selfUserId: string;
    safetyFingerprint?: string;
  }): Promise<void> {
    this.isEnabled = params.enabled;
    this.roomId = params.roomId || "room";
    this.keyVersion = params.keyVersion ?? 1;
    this.isHost = params.isHost;
    this.selfUserId = params.selfUserId;

    if (!this.isEnabled) {
      this.roomKey = null;
      this.safetyFingerprint = null;
      return;
    }

    await this.initializeMemberKeys();

    if (this.isHost && !this.roomKey) {
      // Host generates new room key and distributes
      await this.generateAndDistributeRoomKey();
    }
  }

  /**
   * Calculates and updates the 30-digit verifiable safety fingerprint.
   */
  public async refreshSafetyFingerprint(): Promise<string | null> {
    if (!this.isEnabled) return null;
    const members = this.membersProvider ? this.membersProvider() : [];
    const publicKeys = members
      .map((m) => m.e2eePublicKey)
      .filter((k): k is string => Boolean(k));

    if (this.memberPublicKeyBase64 && !publicKeys.includes(this.memberPublicKeyBase64)) {
      publicKeys.push(this.memberPublicKeyBase64);
    }

    const fingerprint = await E2eeCrypto.generateSafetyFingerprint(this.roomId, publicKeys);
    this.safetyFingerprint = fingerprint;
    this.onFingerprintChange?.(fingerprint);
    return fingerprint;
  }

  /**
   * Host action: generates a fresh AES-GCM-256 key, wraps it for all peers, and transmits packages.
   */
  public async generateAndDistributeRoomKey(newVersion?: number): Promise<void> {
    if (!this.isEnabled || !this.memberKeyPair) return;

    if (newVersion) {
      this.keyVersion = newVersion;
    }

    const newRoomKey = await E2eeCrypto.generateRoomKey();
    this.roomKey = newRoomKey;
    await this.refreshSafetyFingerprint();
    this.onKeyRotatedCallback?.(this.keyVersion);

    const members = this.membersProvider ? this.membersProvider() : [];
    const packages: Array<{ targetUserId: string; wrappedKey: string; iv: string }> = [];

    for (const member of members) {
      if (member.userId === this.selfUserId) continue; // Host already has key
      if (!member.e2eePublicKey) continue;

      try {
        const peerKey = await E2eeCrypto.importPublicKey(member.e2eePublicKey);
        const wrappingKey = await E2eeCrypto.deriveSharedWrappingKey(
          this.memberKeyPair.privateKey,
          peerKey
        );
        const { wrappedKey, iv } = await E2eeCrypto.wrapRoomKey(newRoomKey, wrappingKey);
        packages.push({
          targetUserId: member.userId,
          wrappedKey,
          iv,
        });
      } catch (err) {
        // Skip un-wrappable peer
      }
    }

    if (packages.length > 0 && this.wsSender) {
      this.wsSender({
        type: "ROOM_E2EE_KEY_DISTRIBUTE",
        payload: {
          keyVersion: this.keyVersion,
          packages,
        },
      });
    }
  }

  /**
   * Peer action: unwraps received room key package from the host.
   */
  public async handleIncomingKeyPackage(payload: {
    keyVersion: number;
    hostUserId: string;
    hostPublicKey: string;
    wrappedKey: string;
    iv: string;
  }): Promise<void> {
    if (!this.isEnabled || !this.memberKeyPair) return;

    try {
      const hostKey = await E2eeCrypto.importPublicKey(payload.hostPublicKey);
      const wrappingKey = await E2eeCrypto.deriveSharedWrappingKey(
        this.memberKeyPair.privateKey,
        hostKey
      );

      const unwrappedKey = await E2eeCrypto.unwrapRoomKey(
        payload.wrappedKey,
        payload.iv,
        wrappingKey
      );

      this.roomKey = unwrappedKey;
      this.keyVersion = payload.keyVersion;
      await this.refreshSafetyFingerprint();

      this.onKeyRotatedCallback?.(this.keyVersion);
    } catch (err) {
      // Key unwrap error handled gracefully
    }
  }

  /**
   * Key rotation signal handler from server (e.g. member left/kicked or host promoted).
   */
  public async handleKeyRotated(payload: {
    keyVersion: number;
    reason: "member_left" | "member_kicked" | "host_changed";
  }): Promise<void> {
    if (!this.isEnabled) return;
    this.keyVersion = payload.keyVersion;

    if (this.isHost) {
      // Host generates new room key and distributes to remaining members
      await this.generateAndDistributeRoomKey(payload.keyVersion);
    } else {
      // Invalidate current room key until new package arrives from host (forward secrecy)
      this.roomKey = null;
      this.onKeyRotatedCallback?.(payload.keyVersion);
    }
  }

  /**
   * When a new peer joins an E2EE room, host wraps current room key for them.
   */
  public async handlePeerJoined(member: MemberPublicInfo): Promise<void> {
    if (!this.isEnabled || !this.isHost || !this.roomKey || !this.memberKeyPair) return;
    if (!member.e2eePublicKey || member.userId === this.selfUserId) return;

    try {
      const peerKey = await E2eeCrypto.importPublicKey(member.e2eePublicKey);
      const wrappingKey = await E2eeCrypto.deriveSharedWrappingKey(
        this.memberKeyPair.privateKey,
        peerKey
      );
      const { wrappedKey, iv } = await E2eeCrypto.wrapRoomKey(this.roomKey, wrappingKey);

      await this.refreshSafetyFingerprint();

      if (this.wsSender) {
        this.wsSender({
          type: "ROOM_E2EE_KEY_DISTRIBUTE",
          payload: {
            keyVersion: this.keyVersion,
            packages: [
              {
                targetUserId: member.userId,
                wrappedKey,
                iv,
              },
            ],
          },
        });
      }
    } catch {
      // ignore wrap failure for malformed peer key
    }
  }

  /**
   * Encrypts plaintext chat text with the active room key.
   */
  public async encryptChat(text: string): Promise<{ ciphertext: string; iv: string; keyVersion: number } | null> {
    if (!this.isEnabled || !this.roomKey) return null;

    const payload: EncryptedChatPayload = await E2eeCrypto.encryptChatMessage(
      text,
      this.roomKey,
      this.keyVersion,
      this.selfUserId
    );
    return {
      ciphertext: payload.ciphertext,
      iv: payload.iv,
      keyVersion: this.keyVersion,
    };
  }

  /**
   * Decrypts ciphertext with the active room key.
   */
  public async decryptChat(ciphertext: string, iv: string, messageKeyVersion?: number): Promise<string> {
    if (!this.isEnabled || !this.roomKey) {
      return "[Encrypted Message - Key Unavailable]";
    }

    if (messageKeyVersion !== undefined && messageKeyVersion !== this.keyVersion) {
      return "[Encrypted Message - Previous Key Version]";
    }

    try {
      const payload: EncryptedChatPayload = {
        ciphertext,
        iv,
        keyVersion: this.keyVersion,
        authorId: "",
        timestamp: Date.now(),
      };
      return await E2eeCrypto.decryptChatMessage(payload, this.roomKey);
    } catch {
      return "[Decryption Error]";
    }
  }
}
