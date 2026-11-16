import crypto from "node:crypto";
import { ManajerkuAppError } from "../services/platform-core.ts";

/**
 * Validates email format and normalizes to lowercase.
 */
export function normalizeAndValidateEmail(rawEmail: string): string {
  const email = rawEmail.trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  if (!email || !emailRegex.test(email)) {
    throw new ManajerkuAppError(
      "INVALID_EMAIL",
      "Format alamat email tidak valid.",
      400
    );
  }
  return email;
}

/**
 * Validates password strength (min 8 chars, at least 1 letter and 1 number).
 */
export function validatePasswordStrength(password: string): void {
  if (!password || password.length < 8) {
    throw new ManajerkuAppError(
      "WEAK_PASSWORD",
      "Password wajib terdiri dari minimal 8 karakter.",
      400
    );
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    throw new ManajerkuAppError(
      "WEAK_PASSWORD",
      "Password wajib mengandung kombinasi huruf dan angka.",
      400
    );
  }
}

/**
 * Hashes a plaintext password using Node.js crypto.scryptSync with a 16-byte cryptographic salt.
 */
export function hashPassword(
  plainPassword: string,
  existingSalt?: string
): { passwordHash: string; passwordSalt: string } {
  const salt = existingSalt || crypto.randomBytes(16).toString("hex");
  const derivedKey = crypto.scryptSync(plainPassword, salt, 64);
  return {
    passwordHash: derivedKey.toString("hex"),
    passwordSalt: salt,
  };
}

/**
 * Timing-safe verification of a plaintext password against stored scrypt hash and salt.
 */
export function verifyPassword(
  plainPassword: string,
  storedHash: string,
  storedSalt: string
): boolean {
  if (!plainPassword || !storedHash || !storedSalt) return false;
  try {
    const derivedKey = crypto.scryptSync(plainPassword, storedSalt, 64);
    const storedBuffer = Buffer.from(storedHash, "hex");
    if (derivedKey.length !== storedBuffer.length) return false;
    return crypto.timingSafeEqual(derivedKey, storedBuffer);
  } catch {
    return false;
  }
}

/**
 * Hashes an opaque session or reset token using SHA-256 before storing in the database.
 */
export function hashOpaqueToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

