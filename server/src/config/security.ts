import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Automatically load .env from current working directory or root directory if present
if (typeof process.loadEnvFile === 'function') {
  for (const envPath of [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '../.env')
  ]) {
    if (fs.existsSync(envPath)) {
      try {
        process.loadEnvFile(envPath);
      } catch {
        // ignore errors loading optional env file
      }
    }
  }
}

export enum UserRole {
  STUDENT = 'STUDENT',
  TEACHER = 'TEACHER',
  ADMIN = 'ADMIN'
}

export interface SecurityConfig {
  jwtSecret: string;
  jwtExpiresInSec: number;
  cookieName: string;
  isProduction: boolean;
  teacherRegistrationSecret: string;
  adminRegistrationSecret: string;
  scrypt: {
    n: number;
    r: number;
    p: number;
    keylen: number;
  };
}

export function loadSecurityConfig(env: NodeJS.ProcessEnv = process.env): SecurityConfig {
  const isProd = env.NODE_ENV === 'production';

  const getSecret = (key: string, devFallback: string): string => {
    const val = env[key];
    if (isProd) {
      if (!val) {
        throw new Error(`FATAL: ${key} environment variable must be set in production`);
      }
      return val;
    }
    return val || devFallback;
  };

  return {
    jwtSecret: getSecret('JWT_SECRET', 'dev-insecure-secret-key-must-be-at-least-32-chars-long!'),
    jwtExpiresInSec: 15 * 60, // 15 minutes short-lived access token
    cookieName: '__Secure_Auth_Token',
    isProduction: isProd,
    teacherRegistrationSecret: getSecret('TEACHER_REGISTRATION_SECRET', 'TEACHER_SECRET_INVITE_2026'),
    adminRegistrationSecret: getSecret('ADMIN_REGISTRATION_SECRET', 'ADMIN_SECRET_INVITE_2026'),
    scrypt: {
      n: 16384, // CPU/memory cost
      r: 8,     // Block size
      p: 1,     // Parallelization parameter
      keylen: 64
    }
  };
}

export const securityConfig: SecurityConfig = loadSecurityConfig();

