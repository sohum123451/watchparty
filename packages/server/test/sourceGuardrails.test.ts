import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ServerMessage } from "@watchparty/shared";
import { Room, ActiveConnection } from "../src/rooms/Room.js";
import { UrlSafetyChecker } from "../src/services/UrlSafetyChecker.js";
import { SourceResolver, SecurityError } from "../src/services/SourceResolver.js";
import dns from "node:dns/promises";

function createMockConnection(): { connection: ActiveConnection; messages: ServerMessage[] } {
  const messages: ServerMessage[] = [];
  const connection: ActiveConnection = {
    isAlive: true,
    send: (msg: ServerMessage) => {
      messages.push(msg);
    },
    close: vi.fn(),
  };
  return { connection, messages };
}

describe("Source Guardrails, Safe-Link UX & Origin Streaming", () => {
  let room: Room;
  const hostId = "usr_host_alice";
  let memberBobId: string;
  let memberCharlieId: string;
  let guestDaveId: string;
  let initialPlaylistLen: number;

  let hostConn: ReturnType<typeof createMockConnection>;
  let bobConn: ReturnType<typeof createMockConnection>;
  let charlieConn: ReturnType<typeof createMockConnection>;
  let daveConn: ReturnType<typeof createMockConnection>;

  beforeEach(() => {
    room = new Room({
      roomId: "room_guardrails_test",
      roomCode: "SECURE",
      roomName: "Guardrails Test Room",
      hostUserId: hostId,
      hostUserName: "Alice Host",
      baseUrl: "http://localhost:3000",
    });

    initialPlaylistLen = room.playlist.length;

    hostConn = createMockConnection();
    bobConn = createMockConnection();
    charlieConn = createMockConnection();
    daveConn = createMockConnection();

    // Alice attaches connection as host (host is member 0 in constructor)
    room.attachConnection(hostId, hostConn.connection);

    // Bob connects as regular member
    const bobRes = room.addMember("Bob Member", bobConn.connection, undefined, { role: "member" });
    if (bobRes.success) {
      memberBobId = bobRes.member.userId;
    }

    // Charlie connects as regular member
    const charlieRes = room.addMember("Charlie Member", charlieConn.connection, undefined, { role: "member" });
    if (charlieRes.success) {
      memberCharlieId = charlieRes.member.userId;
    }

    // Dave connects as guest
    const daveRes = room.addMember("Dave Guest", daveConn.connection, undefined, { role: "guest" });
    if (daveRes.success) {
      guestDaveId = daveRes.member.userId;
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("1. Permissions & Link Approval Queue", () => {
    it("allows the host to add playlist items directly by default", () => {
      const result = room.addPlaylistItem(
        hostId,
        1,
        "https://origin.cdn.com/video1.mp4",
        "Test Creator Video",
        120000,
        undefined,
        "html5",
        "https://origin.cdn.com/video1.mp4",
        "Original Creator",
        "origin.cdn.com"
      );

      expect(result.success).toBe(true);
      expect(room.playlist).toHaveLength(initialPlaylistLen + 1);
      const addedItem = room.playlist.find((p) => p.sourceRef === "https://origin.cdn.com/video1.mp4");
      expect(addedItem).toBeDefined();
      expect(addedItem?.domain).toBe("origin.cdn.com");

      // Verify audit log recorded "added"
      const audit = room.sourceAuditLog.find((a) => a.action === "added");
      expect(audit).toBeDefined();
      expect(audit?.userId).toBe(hostId);
      expect(audit?.sourceUrl).toBe("https://origin.cdn.com/video1.mp4");
    });

    it("prevents guests from adding sources directly", () => {
      const result = room.addPlaylistItem(
        guestDaveId,
        1,
        "https://origin.cdn.com/guest-video.mp4",
        "Guest Video",
        60000,
        undefined,
        "html5",
        "https://origin.cdn.com/guest-video.mp4"
      );

      expect(result.success).toBe(false);
      expect(room.playlist).toHaveLength(initialPlaylistLen);
      expect((result as any).code).toBe("PERMISSION_DENIED");
    });

    it("routes member submissions to the approval queue when requireLinkApproval is enabled", async () => {
      // Host toggles requireLinkApproval
      const settingRes = room.updateSourceSettings(hostId, 1, { requireLinkApproval: true });
      expect(settingRes.success).toBe(true);
      expect(room.requireLinkApproval).toBe(true);

      // Verify settings broadcast
      const settingsMsg = bobConn.messages.find((m) => m.type === "SOURCE_SETTINGS_UPDATED");
      expect(settingsMsg).toBeDefined();
      expect((settingsMsg as any).payload.requireLinkApproval).toBe(true);

      // Bob tries to add directly -> should be queued for approval
      const directAdd = room.addPlaylistItem(
        memberBobId,
        1,
        "https://creators.org/episode1.mp3",
        "Bob's Podcast",
        300000,
        undefined,
        "podcast",
        "https://creators.org/episode1.mp3"
      );
      expect(directAdd.success).toBe(true);
      expect((directAdd as any).queued).toBe(true);
      expect(room.playlist).toHaveLength(initialPlaylistLen); // Not in playlist yet!
      expect(room.sourceApprovalQueue.size).toBe(1);

      const queuedSubmission = Array.from(room.sourceApprovalQueue.values())[0];
      expect(queuedSubmission.sourceUrl).toBe("https://creators.org/episode1.mp3");

      // Verify audit log has "submitted"
      const submitAudit = room.sourceAuditLog.find((a) => a.action === "submitted");
      expect(submitAudit).toBeDefined();
      expect(submitAudit?.userId).toBe(memberBobId);

      // Host approves submission
      const approved = room.approveSourceSubmission(hostId, 2, queuedSubmission.id);
      expect(approved.success).toBe(true);
      expect(room.sourceApprovalQueue.size).toBe(0);
      expect(room.playlist).toHaveLength(initialPlaylistLen + 1);
      const approvedItem = room.playlist.find((p) => p.sourceRef === "https://creators.org/episode1.mp3");
      expect(approvedItem).toBeDefined();
      expect(approvedItem?.title).toBe("Bob's Podcast");
      expect(approvedItem?.domain).toBe("creators.org");

      // Verify audit log recorded "approved"
      const approveAudit = room.sourceAuditLog.find((a) => a.action === "approved");
      expect(approveAudit).toBeDefined();
      expect(approveAudit?.userId).toBe(memberBobId);
    });

    it("allows host to reject submission and clears from queue", async () => {
      room.updateSourceSettings(hostId, 1, { requireLinkApproval: true });

      const subRes = await room.submitSource(memberBobId, 1, {
        url: "https://creators.org/spam.mp4",
        actionType: "add_playlist",
        title: "Suspicious Video",
      });

      expect(subRes.success).toBe(true);
      expect(room.sourceApprovalQueue.size).toBe(1);

      const queuedSubmission = Array.from(room.sourceApprovalQueue.values())[0];

      // Host rejects
      const rejected = room.rejectSourceSubmission(hostId, 2, queuedSubmission.id, "Spam link");
      expect(rejected.success).toBe(true);
      expect(room.sourceApprovalQueue.size).toBe(0);
      expect(room.playlist).toHaveLength(initialPlaylistLen);

      // Verify audit log recorded "rejected"
      const rejectAudit = room.sourceAuditLog.find((a) => a.action === "rejected");
      expect(rejectAudit).toBeDefined();
      expect(rejectAudit?.action).toBe("rejected");
    });

    it("allows approved members in approvedSourceAdders to bypass approval queue", () => {
      room.updateSourceSettings(hostId, 1, { requireLinkApproval: true });

      // Host explicitly permits Charlie
      const permitRes = room.permitSourceAdder(hostId, 2, memberCharlieId, true);
      expect(permitRes.success).toBe(true);
      expect(room.approvedSourceAdders.has(memberCharlieId)).toBe(true);

      // Charlie adds directly -> succeeds without queuing
      const result = room.addPlaylistItem(
        memberCharlieId,
        1,
        "https://open-media.org/doc.mp4",
        "Charlie's Approved Doc",
        180000,
        undefined,
        "html5",
        "https://open-media.org/doc.mp4"
      );

      expect(result.success).toBe(true);
      expect((result as any).queued).toBeUndefined();
      expect(room.playlist).toHaveLength(initialPlaylistLen + 1);
      expect(room.sourceApprovalQueue.size).toBe(0);
    });
  });

  describe("2. Safe-Link UX & URL Safety Checker", () => {
    let checker: UrlSafetyChecker;

    beforeEach(() => {
      checker = new UrlSafetyChecker();
    });

    it("flags test malicious domains from platform threat lists as malicious", async () => {
      const rep1 = await checker.checkUrl("https://testsafebrowsing.appspot.com/s/malware.html");
      expect(rep1.isSafe).toBe(false);
      expect(rep1.safetyLevel).toBe("malicious");

      const rep2 = await checker.checkUrl("http://ianfette.org/malware.exe");
      expect(rep2.isSafe).toBe(false);
      expect(rep2.safetyLevel).toBe("malicious");
    });

    it("identifies legitimate creator domains as safe", async () => {
      const rep = await checker.checkUrl("https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4");
      expect(rep.isSafe).toBe(true);
      expect(rep.safetyLevel).toBe("safe");
      expect(rep.domain).toBe("commondatastorage.googleapis.com");
    });

    it("blocks immediate addition of platform blocklisted domains", () => {
      const result = room.addPlaylistItem(
        hostId,
        1,
        "https://testsafebrowsing.appspot.com/bad.mp4",
        "Malicious Stream",
        120000,
        undefined,
        "html5",
        "https://testsafebrowsing.appspot.com/bad.mp4"
      );

      expect(result.success).toBe(false);
      expect(room.playlist).toHaveLength(initialPlaylistLen);

      // Audit log records blocked attempt
      const blockAudit = room.sourceAuditLog.find((a) => a.action === "blocked");
      expect(blockAudit).toBeDefined();
      expect(blockAudit?.sourceUrl).toContain("testsafebrowsing.appspot.com");
    });

    it("allows room host to manage custom blocklist rules", () => {
      // Host adds blocklist rule for suspicious-site.com
      const addRes = room.addSourceBlocklistRule(hostId, 1, "suspicious-site.com", "Known deceptive host");
      expect(addRes.success).toBe(true);
      expect(room.sourceBlocklist.size).toBe(1);

      // Non-host attempts to add URL from blocked domain
      const result = room.addPlaylistItem(
        memberBobId,
        1,
        "https://sub.suspicious-site.com/movie.mp4",
        "Deceptive Video",
        90000,
        undefined,
        "html5",
        "https://sub.suspicious-site.com/movie.mp4"
      );

      expect(result.success).toBe(false);
      expect(room.playlist).toHaveLength(initialPlaylistLen);

      // Host removes blocklist rule
      const ruleId = Array.from(room.sourceBlocklist.values())[0].id;
      const removeRes = room.removeSourceBlocklistRule(hostId, 2, ruleId);
      expect(removeRes.success).toBe(true);
      expect(room.sourceBlocklist.size).toBe(0);
    });
  });

  describe("3. Direct Origin Streaming & Creator Attribution", () => {
    it("stores and emits creator attribution, domain badge, and originalUrl", () => {
      const changeRes = room.applyChangeVideo(
        hostId,
        1,
        "https://archive.org/details/elephants-dream",
        0,
        false,
        "html5",
        "https://archive.org/download/elephants-dream/elephants-dream.mp4",
        "Elephants Dream",
        "Blender Foundation",
        "Creative Commons Attribution 2.5"
      );

      expect(changeRes.success).toBe(true);
      expect(room.playback.domain).toBe("archive.org");
      expect(room.playback.author).toBe("Blender Foundation");
      expect(room.playback.originalUrl).toBe("https://archive.org/download/elephants-dream/elephants-dream.mp4");
      expect(room.playback.license).toBe("Creative Commons Attribution 2.5");

      // Verify snapshot contains attribution fields
      const snapshot = room.getSnapshot(memberBobId);
      expect(snapshot.playback.domain).toBe("archive.org");
      expect(snapshot.playback.author).toBe("Blender Foundation");
      expect(snapshot.playback.originalUrl).toBe("https://archive.org/download/elephants-dream/elephants-dream.mp4");
      expect(snapshot.requireLinkApproval).toBe(false);
    });
  });

  describe("4. Report Source Action & Moderation Audit", () => {
    it("records user reports and adds report entry to audit log", () => {
      const reportRes = room.reportSource(
        memberBobId,
        1,
        "https://suspicious.org/phishing",
        "malware_phishing",
        "Page attempts to download executable when viewed"
      );

      expect(reportRes.success).toBe(true);
      expect((reportRes as any).report?.reason).toBe("malware_phishing");
      expect(room.sourceReports.size).toBe(1);

      // Audit log records reported action
      const reportAudit = room.sourceAuditLog.find((a) => a.action === "reported");
      expect(reportAudit).toBeDefined();
      expect(reportAudit?.userId).toBe(memberBobId);
      expect(reportAudit?.userName).toBe("Bob Member");
      expect(reportAudit?.sourceUrl).toBe("https://suspicious.org/phishing");

      // Host should receive notification
      const reportMsg = hostConn.messages.find((m) => m.type === "SOURCE_REPORT_RECORDED");
      expect(reportMsg).toBeDefined();
    });
  });

  describe("5. SourceResolver Integration with Safety Check", () => {
    it("integrates with SourceResolver to block unsafe URLs with SecurityError", async () => {
      const resolver = new SourceResolver({ timeoutMs: 1000 });

      vi.spyOn(dns, "lookup").mockImplementation(async () => {
        return [{ address: "93.184.216.34", family: 4 }];
      });

      // Malicious URL from blocklist
      await expect(
        resolver.resolve("https://testsafebrowsing.appspot.com/s/malware.html")
      ).rejects.toThrow(SecurityError);
    });
  });
});
