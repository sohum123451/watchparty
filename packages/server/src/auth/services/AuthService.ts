import crypto from "node:crypto";
import { IAuthRepository } from "../db/AuthRepository.js";
import { UserRow } from "../db/schema.js";
import { PasswordSecurity } from "../crypto/password.js";
import { TokenSecurity } from "../crypto/tokens.js";
import { Mailer } from "../mailer/Mailer.js";
import { RateLimiterService } from "./RateLimiterService.js";
import { WsTicketService, AuthenticatedUser } from "./WsTicketService.js";
import {
  WS_CLOSE_CODES,
  UserProfile,
  ActiveSession,
  UserPrivacySettings,
  NotificationPreferences,
  UserProfileUpdateSchema,
  ChangeEmailRequestSchema,
  ChangePasswordSchema,
  DeleteAccountSchema,
} from "@watchparty/shared";
import { MemoryObjectStorageService } from "../../storage/ObjectStorageService.js";
import type { UserDataService } from "../../userdata/UserDataService.js";

export interface AuthSessionResponse {
  user: AuthenticatedUser;
  accessToken: string;
  refreshToken: string;
}

export class AuthService {
  private repo: IAuthRepository;
  private mailer: Mailer;
  private rateLimiter: RateLimiterService;
  private wsTicketService: WsTicketService;
  private baseUrl: string;
  private objectStorage: MemoryObjectStorageService;
  private adminService?: any;

  constructor(options: {
    repo: IAuthRepository;
    mailer: Mailer;
    rateLimiter?: RateLimiterService;
    wsTicketService?: WsTicketService;
    baseUrl?: string;
    objectStorage?: MemoryObjectStorageService;
    adminService?: any;
  }) {
    this.repo = options.repo;
    this.mailer = options.mailer;
    this.rateLimiter = options.rateLimiter || new RateLimiterService();
    this.wsTicketService = options.wsTicketService || new WsTicketService();
    this.baseUrl = options.baseUrl || "http://localhost:3000";
    this.objectStorage = options.objectStorage || new MemoryObjectStorageService(this.baseUrl);
    this.adminService = options.adminService;
  }

  public setAdminService(adminService: any): void {
    this.adminService = adminService;
  }

  public getObjectStorage(): MemoryObjectStorageService {
    return this.objectStorage;
  }

  public getWsTicketService(): WsTicketService {
    return this.wsTicketService;
  }

  public getRateLimiter(): RateLimiterService {
    return this.rateLimiter;
  }

  public getRepo(): IAuthRepository {
    return this.repo;
  }

  public getMailer(): Mailer {
    return this.mailer;
  }

  /**
   * Registers a new user with Argon2id password hashing and dispatches a signed verification email.
   */
  public async signup(data: {
    email: string;
    password: string;
    displayName: string;
    avatar?: string;
    deviceInfo?: string;
    clientIp?: string;
    inviteCode?: string;
  }): Promise<AuthSessionResponse> {
    // 0. Invite-Only Registration Gate & Emergency Kill Switch
    if (this.adminService) {
      const inviteCheck = this.adminService.validateAndConsumeInvite(data.inviteCode);
      if (!inviteCheck.valid) {
        const err: any = new Error(inviteCheck.reason || "Registration requires a valid invite code");
        err.status = 403;
        err.code = "INVITE_REQUIRED";
        throw err;
      }
    }

    const emailKey = `signup:email:${data.email.toLowerCase().trim()}`;
    const ipKey = `signup:ip:${data.clientIp || "unknown"}`;

    const ipLock = this.rateLimiter.check(ipKey);
    if (!ipLock.allowed) {
      const err: any = new Error(`Too many signup attempts. Please try again in ${ipLock.retryAfterSeconds} seconds.`);
      err.status = 429;
      throw err;
    }

    const email = data.email.toLowerCase().trim();
    if (!email || !email.includes("@")) {
      const err: any = new Error("A valid email address is required");
      err.status = 400;
      throw err;
    }

    // Password policy check
    const policy = PasswordSecurity.validatePassword(data.password);
    if (!policy.isValid) {
      const err: any = new Error(policy.errors.join("; "));
      err.status = 400;
      throw err;
    }

    // Check existing email
    const existing = await this.repo.findUserByEmail(email);
    if (existing) {
      this.rateLimiter.recordFailure(ipKey);
      const err: any = new Error("An account with this email address already exists");
      err.status = 409;
      throw err;
    }

    // Hash password with Argon2id
    const passwordHash = await PasswordSecurity.hashPassword(data.password);

    // Create user
    const user = await this.repo.createUser({
      email,
      passwordHash,
      displayName: data.displayName.trim() || email.split("@")[0],
      avatar: data.avatar,
      emailVerifiedAt: null,
    });

    // Create single-use email verification token (24-hour expiry)
    const rawVerifyToken = TokenSecurity.generateRandomToken(32);
    const verifyTokenHash = TokenSecurity.hashToken(rawVerifyToken);
    await this.repo.createEmailToken({
      userId: user.id,
      type: "verify",
      tokenHash: verifyTokenHash,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    const verifyUrl = `${this.baseUrl}/verify-email?token=${rawVerifyToken}`;
    await this.mailer.sendVerificationEmail(user.email, rawVerifyToken, verifyUrl);
    this.adminService?.recordEmailSent();

    // Create session (familyId = new UUID)
    const familyId = crypto.randomUUID();
    const rawRefreshToken = TokenSecurity.generateRandomToken(40);
    const refreshTokenHash = TokenSecurity.hashToken(rawRefreshToken);
    await this.repo.createRefreshToken({
      userId: user.id,
      tokenHash: refreshTokenHash,
      familyId,
      deviceInfo: data.deviceInfo,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
    });

    const accessToken = await TokenSecurity.signAccessToken({
      userId: user.id,
      email: user.email,
      displayName: user.displayName,
      isEmailVerified: false,
    });

    this.rateLimiter.recordSuccess(ipKey);

    return {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        avatar: user.avatar,
        isEmailVerified: false,
      },
      accessToken,
      refreshToken: rawRefreshToken,
    };
  }

  /**
   * Logs in an existing user with rate limiting and lockout on failed attempts.
   */
  public async login(data: {
    email: string;
    password: string;
    deviceInfo?: string;
    clientIp?: string;
  }): Promise<AuthSessionResponse> {
    const email = data.email.toLowerCase().trim();
    const accountKey = `login:account:${email}`;
    const ipKey = `login:ip:${data.clientIp || "unknown"}`;

    const accountLock = this.rateLimiter.check(accountKey);
    if (!accountLock.allowed) {
      const err: any = new Error(`Account temporarily locked due to consecutive failed attempts. Retry in ${accountLock.retryAfterSeconds}s.`);
      err.status = 429;
      throw err;
    }

    const ipLock = this.rateLimiter.check(ipKey);
    if (!ipLock.allowed) {
      const err: any = new Error(`Too many login attempts from this IP. Retry in ${ipLock.retryAfterSeconds}s.`);
      err.status = 429;
      throw err;
    }

    const user = await this.repo.findUserByEmail(email);
    if (!user) {
      this.rateLimiter.recordFailure(accountKey);
      this.rateLimiter.recordFailure(ipKey);
      const err: any = new Error("Invalid email or password");
      err.status = 401;
      throw err;
    }

    if (user.isBanned) {
      const reason = user.bannedReason ? ` (${user.bannedReason})` : "";
      const err: any = new Error(`Your account has been suspended${reason}`);
      err.status = 403;
      err.code = "ACCOUNT_BANNED";
      throw err;
    }

    const isValidPassword = await PasswordSecurity.verifyPassword(data.password, user.passwordHash);
    if (!isValidPassword) {
      this.rateLimiter.recordFailure(accountKey);
      this.rateLimiter.recordFailure(ipKey);
      const err: any = new Error("Invalid email or password");
      err.status = 401;
      throw err;
    }

    // Success: reset failures
    this.rateLimiter.recordSuccess(accountKey);
    this.rateLimiter.recordSuccess(ipKey);

    // Issue rotating refresh token with new familyId
    const familyId = crypto.randomUUID();
    const rawRefreshToken = TokenSecurity.generateRandomToken(40);
    const refreshTokenHash = TokenSecurity.hashToken(rawRefreshToken);
    await this.repo.createRefreshToken({
      userId: user.id,
      tokenHash: refreshTokenHash,
      familyId,
      deviceInfo: data.deviceInfo,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    const isEmailVerified = user.emailVerifiedAt !== null;
    const accessToken = await TokenSecurity.signAccessToken({
      userId: user.id,
      email: user.email,
      displayName: user.displayName,
      isEmailVerified,
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        avatar: user.avatar,
        isEmailVerified,
      },
      accessToken,
      refreshToken: rawRefreshToken,
    };
  }

  /**
   * Authenticates or provisions a patron via Google Identity / OAuth.
   * Links to existing account if email matches, otherwise creates verified patron account.
   */
  public async loginWithGoogle(data: {
    googleId: string;
    email: string;
    displayName?: string;
    avatar?: string;
    deviceInfo?: string;
    clientIp?: string;
  }): Promise<AuthSessionResponse> {
    const email = data.email.toLowerCase().trim();
    if (!email || !email.includes("@")) {
      const err: any = new Error("A valid email address is required from Google profile");
      err.status = 400;
      throw err;
    }

    if (!data.googleId) {
      const err: any = new Error("Google subject identifier (googleId) is required");
      err.status = 400;
      throw err;
    }

    // 1. Look for existing user by googleId
    let user = await this.repo.findUserByGoogleId(data.googleId);

    // 2. If not found by googleId, find by email to link accounts
    if (!user) {
      user = await this.repo.findUserByEmail(email);
      if (user) {
        user = await this.repo.updateUser(user.id, {
          googleId: data.googleId,
          emailVerifiedAt: user.emailVerifiedAt || new Date(),
          avatar: user.avatar || data.avatar,
        });
      }
    }

    // 3. If account still does not exist, provision a new patron
    if (!user) {
      const randomPassword = crypto.randomBytes(32).toString("hex");
      const passwordHash = await PasswordSecurity.hashPassword(randomPassword);
      user = await this.repo.createUser({
        email,
        passwordHash,
        displayName: data.displayName?.trim() || email.split("@")[0],
        avatar: data.avatar,
        googleId: data.googleId,
        emailVerifiedAt: new Date(),
      });
    }

    if (user.isBanned) {
      const err: any = new Error(`Account has been suspended: ${user.bannedReason || "Contact cinema management"}`);
      err.status = 403;
      throw err;
    }

    // 4. Issue refresh token and session
    const familyId = crypto.randomUUID();
    const rawRefreshToken = TokenSecurity.generateRandomToken(40);
    const refreshTokenHash = TokenSecurity.hashToken(rawRefreshToken);
    await this.repo.createRefreshToken({
      userId: user.id,
      tokenHash: refreshTokenHash,
      familyId,
      deviceInfo: data.deviceInfo,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    const accessToken = await TokenSecurity.signAccessToken({
      userId: user.id,
      email: user.email,
      displayName: user.displayName,
      isEmailVerified: true,
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        avatar: user.avatar,
        isEmailVerified: true,
      },
      accessToken,
      refreshToken: rawRefreshToken,
    };
  }

  /**
   * Rotates a refresh token. Detects token reuse and revokes the whole token family if reuse is detected.
   */
  public async refresh(rawRefreshToken: string, deviceInfo?: string): Promise<AuthSessionResponse> {
    if (!rawRefreshToken) {
      const err: any = new Error("Refresh token is required");
      err.status = 401;
      throw err;
    }

    const tokenHash = TokenSecurity.hashToken(rawRefreshToken);
    const tokenRecord = await this.repo.findRefreshTokenByHash(tokenHash);

    if (!tokenRecord) {
      const err: any = new Error("Invalid refresh token");
      err.status = 401;
      throw err;
    }

    // ==========================================
    // REUSE DETECTION LOGIC
    // ==========================================
    if (tokenRecord.revokedAt !== null) {
      // Previously rotated or revoked token presented again -> Breached token reuse!
      // Invalidate the ENTIRE token family immediately!
      await this.repo.revokeTokenFamily(tokenRecord.familyId);
      // Terminate all active WebSocket connections for this compromised user
      this.wsTicketService.terminateUserConnections(tokenRecord.userId, WS_CLOSE_CODES.POLICY_VIOLATION, "Token reuse detected");

      const err: any = new Error("Refresh token reuse detected. All sessions in this family have been revoked for your security.");
      err.status = 401;
      throw err;
    }

    // Check expiration
    if (tokenRecord.expiresAt.getTime() < Date.now()) {
      await this.repo.revokeRefreshToken(tokenRecord.id);
      const err: any = new Error("Refresh token expired. Please log in again.");
      err.status = 401;
      throw err;
    }

    const user = await this.repo.findUserById(tokenRecord.userId);
    if (!user) {
      const err: any = new Error("User account no longer exists");
      err.status = 401;
      throw err;
    }

    if (user.isBanned) {
      await this.repo.revokeRefreshToken(tokenRecord.id);
      const err: any = new Error(user.bannedReason || "Your account has been suspended by an administrator.");
      err.status = 403;
      err.code = "ACCOUNT_BANNED";
      throw err;
    }

    // 1. Revoke the presented token (it is now spent)
    await this.repo.revokeRefreshToken(tokenRecord.id);

    // 2. Issue a new replacement token in the SAME family
    const newRawRefreshToken = TokenSecurity.generateRandomToken(40);
    const newTokenHash = TokenSecurity.hashToken(newRawRefreshToken);
    await this.repo.createRefreshToken({
      userId: user.id,
      tokenHash: newTokenHash,
      familyId: tokenRecord.familyId, // Same family maintained
      deviceInfo: deviceInfo || tokenRecord.deviceInfo || undefined,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    const isEmailVerified = user.emailVerifiedAt !== null;
    const newAccessToken = await TokenSecurity.signAccessToken({
      userId: user.id,
      email: user.email,
      displayName: user.displayName,
      isEmailVerified,
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        avatar: user.avatar,
        isEmailVerified,
      },
      accessToken: newAccessToken,
      refreshToken: newRawRefreshToken,
    };
  }

  /**
   * Logs out the current session by revoking the presented refresh token.
   */
  public async logout(rawRefreshToken: string): Promise<void> {
    if (!rawRefreshToken) return;
    const tokenHash = TokenSecurity.hashToken(rawRefreshToken);
    const record = await this.repo.findRefreshTokenByHash(tokenHash);
    if (record) {
      await this.repo.revokeRefreshToken(record.id);
    }
  }

  /**
   * "Log out everywhere": revokes ALL active sessions and refresh tokens for the user,
   * and terminates all active WebSocket connections immediately.
   */
  public async logoutAll(userId: string): Promise<number> {
    const count = await this.repo.revokeAllUserTokens(userId);
    this.wsTicketService.terminateUserConnections(userId, WS_CLOSE_CODES.POLICY_VIOLATION, "Logged out everywhere");
    return count;
  }

  /**
   * Initiates password reset flow with strict enumeration resistance (identical response).
   */
  public async forgotPassword(email: string, clientIp?: string): Promise<{ message: string }> {
    const normalizedEmail = email.toLowerCase().trim();
    const rateKey = `reset:ip:${clientIp || "unknown"}`;

    const lock = this.rateLimiter.check(rateKey);
    if (!lock.allowed) {
      const err: any = new Error(`Too many reset requests. Please wait ${lock.retryAfterSeconds}s.`);
      err.status = 429;
      throw err;
    }

    const standardMessage = "If an account with that email exists, a password reset link has been sent.";

    const user = await this.repo.findUserByEmail(normalizedEmail);
    if (!user) {
      // Enumeration resistance: same response, small simulated delay
      this.rateLimiter.recordFailure(rateKey);
      return { message: standardMessage };
    }

    // Invalidate prior unused reset tokens
    await this.repo.invalidatePendingEmailTokens(user.id, "reset");

    // Generate single-use reset token (30-minute expiry)
    const rawResetToken = TokenSecurity.generateRandomToken(32);
    const resetTokenHash = TokenSecurity.hashToken(rawResetToken);
    await this.repo.createEmailToken({
      userId: user.id,
      type: "reset",
      tokenHash: resetTokenHash,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 minutes
    });

    const resetUrl = `${this.baseUrl}/reset-password?token=${rawResetToken}`;
    await this.mailer.sendPasswordResetEmail(user.email, rawResetToken, resetUrl);
    this.adminService?.recordEmailSent();

    this.rateLimiter.recordSuccess(rateKey);
    return { message: standardMessage };
  }

  /**
   * Completes password reset. Validates token, hashes new password with Argon2id,
   * and revokes ALL existing sessions for the user across all devices.
   */
  public async resetPassword(rawToken: string, newPassword: string): Promise<{ success: boolean; message: string }> {
    if (!rawToken) {
      const err: any = new Error("Reset token is required");
      err.status = 400;
      throw err;
    }

    const policy = PasswordSecurity.validatePassword(newPassword);
    if (!policy.isValid) {
      const err: any = new Error(policy.errors.join("; "));
      err.status = 400;
      throw err;
    }

    const tokenHash = TokenSecurity.hashToken(rawToken);
    const tokenRecord = await this.repo.findEmailTokenByHash(tokenHash, "reset");

    if (!tokenRecord || tokenRecord.usedAt !== null) {
      const err: any = new Error("Invalid or previously used password reset token");
      err.status = 400;
      throw err;
    }

    if (tokenRecord.expiresAt.getTime() < Date.now()) {
      const err: any = new Error("Password reset token has expired. Please request a new one.");
      err.status = 400;
      throw err;
    }

    // Mark token used (single use)
    await this.repo.markEmailTokenUsed(tokenRecord.id);

    // Hash new password with Argon2id
    const newHash = await PasswordSecurity.hashPassword(newPassword);
    await this.repo.updateUser(tokenRecord.userId, { passwordHash: newHash });

    // Revoke all sessions across all devices on password reset
    await this.repo.revokeAllUserTokens(tokenRecord.userId);
    this.wsTicketService.terminateUserConnections(tokenRecord.userId, WS_CLOSE_CODES.POLICY_VIOLATION, "Password reset");

    return {
      success: true,
      message: "Password reset successfully. All existing sessions have been terminated. Please log in with your new password.",
    };
  }

  /**
   * Verifies email address using a single-use token.
   */
  public async verifyEmail(rawToken: string): Promise<{ success: boolean; message: string }> {
    if (!rawToken) {
      const err: any = new Error("Verification token is required");
      err.status = 400;
      throw err;
    }

    const tokenHash = TokenSecurity.hashToken(rawToken);
    const tokenRecord = await this.repo.findEmailTokenByHash(tokenHash, "verify");

    if (!tokenRecord || tokenRecord.usedAt !== null) {
      const err: any = new Error("Invalid or previously used verification token");
      err.status = 400;
      throw err;
    }

    if (tokenRecord.expiresAt.getTime() < Date.now()) {
      const err: any = new Error("Verification token has expired. Please request a new one.");
      err.status = 400;
      throw err;
    }

    await this.repo.markEmailTokenUsed(tokenRecord.id);
    await this.repo.updateUser(tokenRecord.userId, { emailVerifiedAt: new Date() });

    return {
      success: true,
      message: "Email verified successfully. You can now create rooms and invite friends.",
    };
  }

  /**
   * Issues a short-lived single-use ticket for authenticating a WebSocket connection.
   */
  public async createWsTicket(accessToken: string, deviceInfo?: string): Promise<{ ticket: string; expiresInSeconds: number }> {
    const payload = await TokenSecurity.verifyAccessToken(accessToken);
    if (!payload) {
      const err: any = new Error("Invalid or expired access token");
      err.status = 401;
      throw err;
    }

    const user = await this.repo.findUserById(payload.sub);
    if (!user) {
      const err: any = new Error("User account not found");
      err.status = 401;
      throw err;
    }

    const ticket = this.wsTicketService.createTicket({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatar: user.avatar,
      isEmailVerified: user.emailVerifiedAt !== null,
    }, deviceInfo);

    return { ticket, expiresInSeconds: 30 };
  }

  /**
   * Upgrades a guest session to a registered account without dropping room presence.
   */
  public async upgradeGuest(data: {
    guestUserId: string;
    email: string;
    password: string;
    displayName: string;
    deviceInfo?: string;
  }): Promise<AuthSessionResponse> {
    const session = await this.signup({
      email: data.email,
      password: data.password,
      displayName: data.displayName,
      deviceInfo: data.deviceInfo,
    });
    return session;
  }

  // ==========================================
  // USER PROFILE & AVATAR
  // ==========================================

  public async getProfile(userId: string): Promise<UserProfile> {
    const user = await this.repo.findUserById(userId);
    if (!user) {
      const err: any = new Error("User not found");
      err.status = 404;
      throw err;
    }

    let notifPrefs: NotificationPreferences = {
      inApp: {
        friendRequests: true,
        roomInvites: true,
        chatMentions: true,
        coWatchMilestones: true,
      },
      emailDigest: "weekly",
    };
    if (user.notificationPreferences) {
      try {
        notifPrefs = JSON.parse(user.notificationPreferences);
      } catch {
        // default
      }
    }

    const privacy: UserPrivacySettings = {
      presence: (user.presencePrivacy as any) || "friends",
      whoCanFriendMe: (user.whoCanFriendMe as any) || "everyone",
      whoCanInviteMe: (user.whoCanInviteMe as any) || "everyone",
    };

    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      username: user.username ?? undefined,
      friendCode: user.friendCode,
      avatar: user.avatar ?? null,
      bio: user.bio ?? undefined,
      privacySettings: privacy,
      notificationPreferences: notifPrefs,
      createdAt: user.createdAt.toISOString(),
      isEmailVerified: user.emailVerifiedAt !== null,
    };
  }

  public async updateProfile(userId: string, input: unknown): Promise<UserProfile> {
    const validated = UserProfileUpdateSchema.parse(input);
    const user = await this.repo.findUserById(userId);
    if (!user) {
      const err: any = new Error("User not found");
      err.status = 404;
      throw err;
    }

    const updates: Partial<UserRow> = {};

    if (validated.displayName !== undefined) {
      updates.displayName = validated.displayName;
    }
    if (validated.bio !== undefined) {
      updates.bio = validated.bio;
    }
    if (validated.avatar !== undefined) {
      updates.avatar = validated.avatar;
    }
    const privacy = validated.privacySettings;
    if (privacy !== undefined) {
      if (privacy.presence !== undefined) {
        updates.presencePrivacy = privacy.presence;
      }
      if (privacy.whoCanFriendMe !== undefined) {
        updates.whoCanFriendMe = privacy.whoCanFriendMe;
      }
      if (privacy.whoCanInviteMe !== undefined) {
        updates.whoCanInviteMe = privacy.whoCanInviteMe;
      }
    }
    if (validated.notificationPreferences !== undefined) {
      updates.notificationPreferences = JSON.stringify(validated.notificationPreferences);
    }

    await this.repo.updateUser(userId, updates);
    return this.getProfile(userId);
  }

  public async uploadAvatar(
    userId: string,
    buffer: Buffer,
    declaredMimeType?: string
  ): Promise<{ avatarUrl: string; size: number; mimeType: string }> {
    const user = await this.repo.findUserById(userId);
    if (!user) {
      const err: any = new Error("User not found");
      err.status = 404;
      throw err;
    }

    const res = await this.objectStorage.uploadAvatar(userId, buffer, declaredMimeType);
    await this.repo.updateUser(userId, { avatar: res.url });

    return {
      avatarUrl: res.url,
      size: res.size,
      mimeType: res.mimeType,
    };
  }

  // ==========================================
  // ACCOUNT SETTINGS & SECURITY
  // ==========================================

  public async requestEmailChange(
    userId: string,
    input: unknown,
    clientIp?: string
  ): Promise<{ message: string }> {
    const validated = ChangeEmailRequestSchema.parse(input);
    const ipKey = `change_email:ip:${clientIp || "unknown"}`;

    const ipLock = this.rateLimiter.check(ipKey);
    if (!ipLock.allowed) {
      const err: any = new Error(
        `Too many requests. Please try again in ${ipLock.retryAfterSeconds} seconds.`
      );
      err.status = 429;
      throw err;
    }

    const user = await this.repo.findUserById(userId);
    if (!user) {
      const err: any = new Error("User not found");
      err.status = 404;
      throw err;
    }

    // Verify current password
    const isPasswordValid = await PasswordSecurity.verifyPassword(
      validated.password,
      user.passwordHash
    );
    if (!isPasswordValid) {
      this.rateLimiter.recordFailure(ipKey);
      const err: any = new Error("Incorrect password");
      err.status = 400;
      throw err;
    }

    const newEmail = validated.newEmail.toLowerCase().trim();
    if (newEmail === user.email.toLowerCase()) {
      const err: any = new Error("New email must be different from current email");
      err.status = 400;
      throw err;
    }

    // Check if new email is taken
    const existing = await this.repo.findUserByEmail(newEmail);
    if (existing) {
      this.rateLimiter.recordFailure(ipKey);
      const err: any = new Error("An account with this email address already exists");
      err.status = 409;
      throw err;
    }

    // Invalidate pending tokens & create new change_email token
    await this.repo.invalidatePendingEmailTokens(userId, "change_email");
    const rawEmailToken = TokenSecurity.generateRandomToken(32);
    const emailTokenHash = TokenSecurity.hashToken(rawEmailToken);
    await this.repo.createEmailToken({
      userId,
      type: "change_email",
      tokenHash: emailTokenHash,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
    });

    await this.repo.updateUser(userId, { pendingEmail: newEmail });

    const verifyLink = `${this.baseUrl}/verify-email?token=${rawEmailToken}&action=change_email`;
    await this.mailer.sendVerificationEmail(newEmail, rawEmailToken, verifyLink);
    this.rateLimiter.recordSuccess(ipKey);

    return { message: `Verification email sent to ${newEmail}` };
  }

  public async confirmEmailChange(
    rawToken: string
  ): Promise<{ success: boolean; user: AuthenticatedUser }> {
    if (!rawToken) {
      const err: any = new Error("Verification token is required");
      err.status = 400;
      throw err;
    }

    const tokenHash = TokenSecurity.hashToken(rawToken);
    const tokenRecord = await this.repo.findEmailTokenByHash(tokenHash, "change_email");

    if (!tokenRecord || tokenRecord.usedAt !== null) {
      const err: any = new Error("Invalid or previously used verification token");
      err.status = 400;
      throw err;
    }

    if (tokenRecord.expiresAt.getTime() < Date.now()) {
      const err: any = new Error("Verification token has expired. Please request a new one.");
      err.status = 400;
      throw err;
    }

    const user = await this.repo.findUserById(tokenRecord.userId);
    if (!user || !user.pendingEmail) {
      const err: any = new Error("No pending email change request found for this account");
      err.status = 400;
      throw err;
    }

    const updatedUser = await this.repo.updateUser(user.id, {
      email: user.pendingEmail,
      pendingEmail: null,
      emailVerifiedAt: new Date(),
    });

    await this.repo.markEmailTokenUsed(tokenRecord.id);

    return {
      success: true,
      user: {
        id: updatedUser!.id,
        email: updatedUser!.email,
        displayName: updatedUser!.displayName,
        avatar: updatedUser!.avatar,
        isEmailVerified: true,
      },
    };
  }

  public async changePassword(
    userId: string,
    currentRawRefreshToken: string | undefined,
    input: unknown
  ): Promise<{ success: boolean; message: string; revokedSessionsCount: number }> {
    const validated = ChangePasswordSchema.parse(input);
    const user = await this.repo.findUserById(userId);
    if (!user) {
      const err: any = new Error("User not found");
      err.status = 404;
      throw err;
    }

    // Verify current password
    const isCurrentValid = await PasswordSecurity.verifyPassword(
      validated.currentPassword,
      user.passwordHash
    );
    if (!isCurrentValid) {
      const err: any = new Error("Current password is incorrect");
      err.status = 400;
      throw err;
    }

    // Validate new password policy
    const policy = PasswordSecurity.validatePassword(validated.newPassword);
    if (!policy.isValid) {
      const err: any = new Error(policy.errors.join("; "));
      err.status = 400;
      throw err;
    }

    // Hash new password with Argon2id
    const newPasswordHash = await PasswordSecurity.hashPassword(validated.newPassword);
    await this.repo.updateUser(userId, { passwordHash: newPasswordHash });

    // Revoke all other active sessions while preserving current session if provided
    let revokedSessionsCount = 0;
    if (currentRawRefreshToken) {
      const tokenHash = TokenSecurity.hashToken(currentRawRefreshToken);
      const currentToken = await this.repo.findRefreshTokenByHash(tokenHash);
      if (currentToken) {
        revokedSessionsCount = await this.repo.revokeOtherSessions(userId, currentToken.id);
      } else {
        revokedSessionsCount = await this.repo.revokeAllUserTokens(userId);
      }
    } else {
      revokedSessionsCount = await this.repo.revokeAllUserTokens(userId);
    }

    return {
      success: true,
      message: "Password changed successfully. All other active sessions have been revoked.",
      revokedSessionsCount,
    };
  }

  public async getActiveSessions(
    userId: string,
    currentRawRefreshToken?: string
  ): Promise<ActiveSession[]> {
    const tokenRows = await this.repo.getActiveSessions(userId);
    let currentTokenId: string | null = null;
    if (currentRawRefreshToken) {
      const tokenHash = TokenSecurity.hashToken(currentRawRefreshToken);
      const tokenRecord = await this.repo.findRefreshTokenByHash(tokenHash);
      if (tokenRecord) {
        currentTokenId = tokenRecord.id;
      }
    }

    return tokenRows.map((row) => ({
      id: row.id,
      familyId: row.familyId,
      deviceInfo: row.deviceInfo ?? undefined,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      isCurrent: row.id === currentTokenId,
    }));
  }

  public async revokeSession(userId: string, sessionId: string): Promise<boolean> {
    const sessions = await this.repo.getActiveSessions(userId);
    const target = sessions.find((s) => s.id === sessionId);
    if (!target) {
      return false;
    }
    await this.repo.revokeRefreshToken(sessionId);
    return true;
  }

  public async revokeOtherSessions(
    userId: string,
    currentRawRefreshToken: string
  ): Promise<number> {
    const tokenHash = TokenSecurity.hashToken(currentRawRefreshToken);
    const tokenRecord = await this.repo.findRefreshTokenByHash(tokenHash);
    if (!tokenRecord) {
      return 0;
    }
    return this.repo.revokeOtherSessions(userId, tokenRecord.id);
  }

  public async deleteAccount(
    userId: string,
    input: unknown,
    userDataService?: UserDataService
  ): Promise<{ success: boolean; message: string }> {
    const validated = DeleteAccountSchema.parse(input);
    const user = await this.repo.findUserById(userId);
    if (!user) {
      const err: any = new Error("User not found");
      err.status = 404;
      throw err;
    }

    const isValid = await PasswordSecurity.verifyPassword(
      validated.password,
      user.passwordHash
    );
    if (!isValid) {
      const err: any = new Error("Incorrect password. Account deletion aborted.");
      err.status = 400;
      throw err;
    }

    // 1. Cascade user data, friendships, notifications, and room chat message anonymization
    if (userDataService) {
      await userDataService.deleteAccountData(userId);
    }

    // 2. Terminate active WS sockets
    this.wsTicketService.terminateUserConnections(
      userId,
      WS_CLOSE_CODES.POLICY_VIOLATION,
      "Account deleted"
    );

    // 3. Delete user and all authentication tokens
    await this.repo.deleteUser(userId);

    return {
      success: true,
      message: "Account and associated data deleted successfully. Room messages anonymized.",
    };
  }
}
