import { hash, verify, Algorithm } from "@node-rs/argon2";

// Common passwords blacklist
const COMMON_PASSWORDS = new Set([
  "password",
  "password123",
  "password1",
  "12345678",
  "123456789",
  "1234567890",
  "1234567",
  "11111111",
  "00000000",
  "qwertyuiop",
  "asdfghjkl",
  "zxcvbnm",
  "iloveyou",
  "welcome",
  "welcome1",
  "welcome123",
  "admin123",
  "administrator",
  "letmein",
  "monkey",
  "dragon",
  "football",
  "master",
  "sunshine",
  "princess",
  "superman",
  "batman",
  "trustno1",
  "charlie",
]);

export interface PasswordPolicyResult {
  isValid: boolean;
  errors: string[];
}

export class PasswordSecurity {
  /**
   * Hashes a password using Argon2id with OWASP-recommended parameters.
   */
  public static async hashPassword(plaintext: string): Promise<string> {
    return hash(plaintext, {
      algorithm: Algorithm.Argon2id,
      memoryCost: 19456, // 19 MiB
      timeCost: 2,       // 2 iterations
      parallelism: 1,    // 1 thread
    });
  }

  /**
   * Verifies a plaintext password against an Argon2id hash.
   */
  public static async verifyPassword(plaintext: string, hashString: string): Promise<boolean> {
    try {
      return await verify(hashString, plaintext);
    } catch {
      return false;
    }
  }

  /**
   * Validates password against security policy and common password dictionary.
   */
  public static validatePassword(password: string): PasswordPolicyResult {
    const errors: string[] = [];

    if (!password || password.length < 8) {
      errors.push("Password must be at least 8 characters long");
    }

    if (password.length > 128) {
      errors.push("Password must not exceed 128 characters");
    }

    if (!/[A-Z]/.test(password)) {
      errors.push("Password must contain at least one uppercase letter");
    }

    if (!/[a-z]/.test(password)) {
      errors.push("Password must contain at least one lowercase letter");
    }

    if (!/[0-9]/.test(password)) {
      errors.push("Password must contain at least one numeric digit");
    }

    if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)) {
      errors.push("Password must contain at least one special character");
    }

    const normalized = password.toLowerCase().trim();
    if (COMMON_PASSWORDS.has(normalized)) {
      errors.push("Password is too common and easily guessable; please choose a stronger password");
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }
}
