import { AuthService, AuthSessionResponse } from "./AuthService.js";
import { PasswordSecurity } from "../crypto/password.js";
import { TokenSecurity } from "../crypto/tokens.js";

export interface GoogleProfile {
  id: string; // google sub
  email: string;
  name: string;
  picture?: string;
  emailVerified: boolean;
}

export class GoogleOAuthService {
  private authService: AuthService;
  private clientId: string;
  private clientSecret: string;
  private redirectUri: string;

  constructor(
    authService: AuthService,
    options: { clientId?: string; clientSecret?: string; redirectUri?: string } = {}
  ) {
    this.authService = authService;
    this.clientId = options.clientId || process.env.GOOGLE_CLIENT_ID || "mock-google-client-id";
    this.clientSecret = options.clientSecret || process.env.GOOGLE_CLIENT_SECRET || "mock-google-secret";
    this.redirectUri = options.redirectUri || process.env.GOOGLE_REDIRECT_URI || "http://localhost:3000/api/auth/google/callback";
  }

  /**
   * Generates Google OAuth consent screen authorization URL.
   */
  public getAuthorizationUrl(state?: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: "code",
      scope: "openid email profile",
      access_type: "offline",
      prompt: "consent",
    });
    if (state) {
      params.append("state", state);
    }
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  /**
   * Authenticates or registers a user using a verified Google profile.
   * Matches by googleId or existing email, marking email verified.
   */
  public async handleGoogleProfile(
    profile: GoogleProfile,
    deviceInfo?: string
  ): Promise<AuthSessionResponse> {
    const repo = this.authService.getRepo();
    const email = profile.email.toLowerCase().trim();

    // 1. Check if user already exists by googleId
    let user = await repo.findUserByGoogleId(profile.id);

    // 2. Or check if user already exists with matching email
    if (!user) {
      user = await repo.findUserByEmail(email);
      if (user) {
        // Link Google ID to existing account
        user = await repo.updateUser(user.id, {
          googleId: profile.id,
          avatar: user.avatar || profile.picture || null,
          emailVerifiedAt: user.emailVerifiedAt || new Date(),
        });
      }
    }

    // 3. If new user, create user record with pre-verified email
    if (!user) {
      const dummyPassword = TokenSecurity.generateRandomToken(32) + "!A1";
      const dummyHash = await PasswordSecurity.hashPassword(dummyPassword);

      user = await repo.createUser({
        email,
        passwordHash: dummyHash,
        displayName: profile.name.trim() || email.split("@")[0],
        avatar: profile.picture,
        emailVerifiedAt: new Date(),
        googleId: profile.id,
      });
    }

    // 4. Issue standard session & rotating refresh token
    const familyId = crypto.randomUUID();
    const rawRefreshToken = TokenSecurity.generateRandomToken(40);
    const refreshTokenHash = TokenSecurity.hashToken(rawRefreshToken);
    await repo.createRefreshToken({
      userId: user.id,
      tokenHash: refreshTokenHash,
      familyId,
      deviceInfo,
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
}
