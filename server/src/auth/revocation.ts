import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

/**
 * Server-Authoritative Token Revocation Service
 * Stores SHA-256 hashes of revoked tokens with their expiration timestamps.
 * Entries automatically expire when the underlying token expires.
 */
export class TokenRevocationService {
  private revokedTokens: Map<string, number> = new Map();

  constructor() {
    // Periodic cleanup of expired tokens every 60 seconds
    setInterval(() => {
      this.prune();
    }, 60 * 1000).unref();
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Revoke a token until its expiration time.
   */
  public revoke(token: string): void {
    if (!token) return;
    const key = this.hashToken(token);
    try {
      const decoded = jwt.decode(token) as { exp?: number } | null;
      const expiresAtMs = decoded?.exp ? decoded.exp * 1000 : Date.now() + 15 * 60 * 1000;
      this.revokedTokens.set(key, expiresAtMs);
    } catch {
      this.revokedTokens.set(key, Date.now() + 15 * 60 * 1000);
    }
  }

  /**
   * Check if a token has been explicitly revoked.
   */
  public isRevoked(token: string): boolean {
    if (!token) return false;
    const key = this.hashToken(token);
    const expiresAt = this.revokedTokens.get(key);
    if (!expiresAt) return false;

    if (Date.now() > expiresAt) {
      this.revokedTokens.delete(key);
      return false;
    }
    return true;
  }

  public prune(): void {
    const now = Date.now();
    for (const [key, exp] of this.revokedTokens.entries()) {
      if (now > exp) {
        this.revokedTokens.delete(key);
      }
    }
  }

  public clear(): void {
    this.revokedTokens.clear();
  }
}

export const defaultRevocationService = new TokenRevocationService();
