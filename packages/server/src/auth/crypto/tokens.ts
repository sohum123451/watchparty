import crypto from "node:crypto";
import { SignJWT, jwtVerify, JWTPayload } from "jose";

const DEFAULT_SECRET = process.env.JWT_SECRET || "watchparty_super_secret_jwt_key_at_least_32_characters_long_12345";
const SECRET_KEY = new TextEncoder().encode(DEFAULT_SECRET);

export interface AccessTokenPayload extends JWTPayload {
  sub: string; // userId
  email: string;
  displayName: string;
  isEmailVerified: boolean;
}

export class TokenSecurity {
  /**
   * Generates a high-entropy, cryptographically secure random token (e.g. for refresh or email tokens).
   */
  public static generateRandomToken(bytes = 32): string {
    return crypto.randomBytes(bytes).toString("hex");
  }

  /**
   * Generates a deterministic SHA-256 hash of a token for secure database storage.
   */
  public static hashToken(rawToken: string): string {
    return crypto.createHash("sha256").update(rawToken).digest("hex");
  }

  /**
   * Signs a short-lived access JWT (~15 minutes).
   */
  public static async signAccessToken(
    payload: { userId: string; email: string; displayName: string; isEmailVerified: boolean },
    expiresIn = "15m"
  ): Promise<string> {
    return new SignJWT({
      email: payload.email,
      displayName: payload.displayName,
      isEmailVerified: payload.isEmailVerified,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(payload.userId)
      .setIssuedAt()
      .setExpirationTime(expiresIn)
      .sign(SECRET_KEY);
  }

  /**
   * Verifies and extracts the payload from an access JWT.
   */
  public static async verifyAccessToken(token: string): Promise<AccessTokenPayload | null> {
    try {
      const { payload } = await jwtVerify(token, SECRET_KEY, {
        algorithms: ["HS256"],
      });
      return {
        sub: payload.sub as string,
        email: payload.email as string,
        displayName: payload.displayName as string,
        isEmailVerified: Boolean(payload.isEmailVerified),
      };
    } catch {
      return null;
    }
  }
}
