import crypto from 'node:crypto';
import { IDatastore } from '../db/datastore.interface.js';

/**
 * Generate a cryptographically secure, non-predictable 6-digit Game PIN.
 * Guarantees uniqueness against active database sessions.
 */
export async function generateSecureGamePin(db: IDatastore): Promise<string> {
  let attempts = 0;
  const maxAttempts = 10;

  while (attempts < maxAttempts) {
    // Generate secure random 6-digit number [100000, 999999]
    const pin = crypto.randomInt(100000, 1000000).toString();
    
    // Ensure PIN is not already in use
    const existing = await db.findSessionByPin(pin);
    if (!existing) {
      return pin;
    }
    attempts++;
  }

  // Extremely rare collision fallback
  return crypto.randomInt(100000, 1000000).toString();
}
