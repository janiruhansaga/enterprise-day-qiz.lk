import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { securityConfig, UserRole } from '../config/security.js';

export interface TokenPayload {
  userId: string;
  email: string;
  role: UserRole;
  displayName: string;
  iat?: number;
  exp?: number;
}

/**
 * Hash a password using scrypt with a cryptographically secure random salt.
 * Output format: scrypt$n$r$p$salt$derivedKey
 */
export async function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    const { n, r, p, keylen } = securityConfig.scrypt;

    crypto.scrypt(password, salt, keylen, { N: n, r, p }, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(`scrypt$${n}$${r}$${p}$${salt}$${derivedKey.toString('hex')}`);
    });
  });
}

/**
 * Verify a candidate password against an scrypt hash using timing-safe comparison.
 * Prevents side-channel timing attacks.
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const parts = storedHash.split('$');
      if (parts.length !== 6 || parts[0] !== 'scrypt') {
        return resolve(false);
      }

      const n = parseInt(parts[1], 10);
      const r = parseInt(parts[2], 10);
      const p = parseInt(parts[3], 10);
      const salt = parts[4];
      const originalKeyHex = parts[5];

      const originalKey = Buffer.from(originalKeyHex, 'hex');

      crypto.scrypt(password, salt, originalKey.length, { N: n, r, p }, (err, derivedKey) => {
        if (err) return resolve(false);
        // Timing-safe equal check to prevent timing analysis
        if (derivedKey.length !== originalKey.length) return resolve(false);
        const match = crypto.timingSafeEqual(derivedKey, originalKey);
        resolve(match);
      });
    } catch {
      resolve(false);
    }
  });
}

/**
 * Sign an authentic JWT containing verified user claims.
 */
export function signAuthToken(payload: Omit<TokenPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, securityConfig.jwtSecret, {
    expiresIn: securityConfig.jwtExpiresInSec,
    algorithm: 'HS256'
  });
}

/**
 * Verify and decode an incoming JWT. Throws or returns null if tampered/expired.
 */
export function verifyAuthToken(token: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, securityConfig.jwtSecret, {
      algorithms: ['HS256']
    }) as TokenPayload;
    return decoded;
  } catch {
    return null;
  }
}
