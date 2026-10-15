import { describe, it, expect, beforeEach } from "vitest";
import {
  E2eeCrypto,
  EncryptedChatPayload,
} from "@watchparty/shared";
import { E2eeManager } from "../src/features/E2eeManager.js";
import { SocialClient } from "../src/social/SocialClient.js";

describe("End-to-End Encrypted (E2EE) Chat Cryptography Suite", () => {
  it("generates WebCrypto ECDH P-256 member keypairs and exports base64 SPKI", async () => {
    const keyPair = await E2eeCrypto.generateMemberKeyPair();
    expect(keyPair.publicKey).toBeDefined();
    expect(keyPair.privateKey).toBeDefined();

    const base64Spki = await E2eeCrypto.exportPublicKey(keyPair.publicKey);
    expect(typeof base64Spki).toBe("string");
    expect(base64Spki.length).toBeGreaterThan(50);

    const imported = await E2eeCrypto.importPublicKey(base64Spki);
    expect(imported.algorithm.name).toBe("ECDH");
  });

  it("derives identical AES-GCM wrapping keys via ECDH and HKDF-SHA-256", async () => {
    const aliceKeys = await E2eeCrypto.generateMemberKeyPair();
    const bobKeys = await E2eeCrypto.generateMemberKeyPair();

    // Alice derives key using Bob's public key
    const aliceWrappingKey = await E2eeCrypto.deriveSharedWrappingKey(
      aliceKeys.privateKey,
      bobKeys.publicKey
    );

    // Bob derives key using Alice's public key
    const bobWrappingKey = await E2eeCrypto.deriveSharedWrappingKey(
      bobKeys.privateKey,
      aliceKeys.publicKey
    );

    // Verify both wrapping keys can encrypt/decrypt the same payload
    const testSecret = new TextEncoder().encode("shared-secret-verification");
    const iv = new Uint8Array(12);
    globalThis.crypto.getRandomValues(iv);

    const ciphertext = await globalThis.crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      aliceWrappingKey,
      testSecret
    );

    const decrypted = await globalThis.crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      bobWrappingKey,
      ciphertext
    );

    expect(new TextDecoder().decode(decrypted)).toBe("shared-secret-verification");
  });

  it("wraps and unwraps AES-GCM-256 room keys securely between host and peers", async () => {
    const hostKeys = await E2eeCrypto.generateMemberKeyPair();
    const peerKeys = await E2eeCrypto.generateMemberKeyPair();

    const hostWrappingKey = await E2eeCrypto.deriveSharedWrappingKey(
      hostKeys.privateKey,
      peerKeys.publicKey
    );
    const peerWrappingKey = await E2eeCrypto.deriveSharedWrappingKey(
      peerKeys.privateKey,
      hostKeys.publicKey
    );

    // Host generates random AES-GCM-256 room key
    const roomKey = await E2eeCrypto.generateRoomKey();
    const { wrappedKey, iv } = await E2eeCrypto.wrapRoomKey(roomKey, hostWrappingKey);

    // Peer receives wrapped package and unwraps
    const unwrappedRoomKey = await E2eeCrypto.unwrapRoomKey(wrappedKey, iv, peerWrappingKey);
    expect(unwrappedRoomKey).toBeDefined();

    // Encrypt with original room key, decrypt with unwrapped room key
    const msg = "Top secret watchparty chat message";
    const encrypted = await E2eeCrypto.encryptChatMessage(msg, roomKey, 1, "host_1");
    const decrypted = await E2eeCrypto.decryptChatMessage(encrypted, unwrappedRoomKey);
    expect(decrypted).toBe(msg);
  });

  it("produces deterministic, verifiable 30-digit safety codes (fingerprints)", async () => {
    const key1 = "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE11111111111111111111111111111111111111111111111111111111111111111111111111111111111111==";
    const key2 = "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE22222222222222222222222222222222222222222222222222222222222222222222222222222222222222==";

    const fp1 = await E2eeCrypto.generateSafetyFingerprint("room_abc", [key1, key2]);
    const fp2 = await E2eeCrypto.generateSafetyFingerprint("room_abc", [key2, key1]); // Out of order

    // Deterministic match regardless of array insertion order
    expect(fp1).toBe(fp2);
    // Format: 6 groups of 5 digits separated by spaces
    expect(fp1).toMatch(/^\d{5} \d{5} \d{5} \d{5} \d{5} \d{5}$/);
  });

  it("handles client-side E2EE room lifecycle, key distribution, and key rotation", async () => {
    const outgoingHostMessages: any[] = [];
    const hostE2ee = new E2eeManager({
      wsSender: (msg) => outgoingHostMessages.push(msg),
    });

    const outgoingPeerMessages: any[] = [];
    const peerE2ee = new E2eeManager({
      wsSender: (msg) => outgoingPeerMessages.push(msg),
    });

    // 1. Members initialize keys
    const hostPubKey = await hostE2ee.initializeMemberKeys();
    const peerPubKey = await peerE2ee.initializeMemberKeys();

    hostE2ee.setMembersProvider(() => [
      {
        userId: "usr_host",
        userName: "Host",
        isHost: true,
        isConnected: true,
        isBuffering: false,
        joinedAt: 100,
        e2eePublicKey: hostPubKey,
      },
      {
        userId: "usr_peer",
        userName: "Peer",
        isHost: false,
        isConnected: true,
        isBuffering: false,
        joinedAt: 200,
        e2eePublicKey: peerPubKey,
      },
    ]);

    // 2. Host initializes room
    await hostE2ee.handleRoomInit({
      enabled: true,
      keyVersion: 1,
      isHost: true,
      selfUserId: "usr_host",
      roomId: "room_test",
    });

    expect(hostE2ee.hasRoomKey()).toBe(true);
    expect(outgoingHostMessages.length).toBe(1);
    const keyDistributeMsg = outgoingHostMessages[0];
    expect(keyDistributeMsg.type).toBe("ROOM_E2EE_KEY_DISTRIBUTE");
    const pkg = keyDistributeMsg.payload.packages[0];

    // 3. Peer joins and initializes room
    await peerE2ee.handleRoomInit({
      enabled: true,
      keyVersion: 1,
      isHost: false,
      selfUserId: "usr_peer",
      roomId: "room_test",
    });

    // Peer receives key package
    await peerE2ee.handleIncomingKeyPackage({
      keyVersion: 1,
      hostUserId: "usr_host",
      hostPublicKey: hostPubKey,
      wrappedKey: pkg.wrappedKey,
      iv: pkg.iv,
    });
    expect(peerE2ee.hasRoomKey()).toBe(true);

    // 4. Chat exchange: Host sends encrypted message, Peer decrypts
    const enc = await hostE2ee.encryptChat("Hello secret watchparty!");
    expect(enc).not.toBeNull();
    const decrypted = await peerE2ee.decryptChat(enc!.ciphertext, enc!.iv, enc!.keyVersion);
    expect(decrypted).toBe("Hello secret watchparty!");

    // 5. Member leaves / is kicked -> Room key rotates to v2
    await hostE2ee.handleKeyRotated({ keyVersion: 2, reason: "member_left" });
    expect(hostE2ee.currentKeyVersion).toBe(2);

    // Former message with version 1 cannot be decrypted with version 2 key (forward secrecy)
    const staleDecryption = await hostE2ee.decryptChat(enc!.ciphertext, enc!.iv, 1);
    expect(staleDecryption).toContain("Previous Key Version");
  });
});
