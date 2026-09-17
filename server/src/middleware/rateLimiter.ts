import { FastifyRequest, FastifyReply } from 'fastify';

interface RateLimitRecord {
  count: number;
  resetTime: number;
}

export class TokenBucketRateLimiter {
  private store: Map<string, RateLimitRecord> = new Map();
  private maxRequests: number;
  private windowMs: number;

  constructor(maxRequests: number, windowMs: number) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;

    // Periodic cleanup of expired records every 60 seconds
    setInterval(() => {
      const now = Date.now();
      for (const [key, record] of this.store.entries()) {
        if (now > record.resetTime) {
          this.store.delete(key);
        }
      }
    }, 60000).unref();
  }

  public check(key: string): { allowed: boolean; remaining: number; resetTime: number } {
    const now = Date.now();
    let record = this.store.get(key);

    if (!record || now > record.resetTime) {
      record = { count: 1, resetTime: now + this.windowMs };
      this.store.set(key, record);
      return { allowed: true, remaining: this.maxRequests - 1, resetTime: record.resetTime };
    }

    if (record.count >= this.maxRequests) {
      return { allowed: false, remaining: 0, resetTime: record.resetTime };
    }

    record.count++;
    return { allowed: true, remaining: this.maxRequests - record.count, resetTime: record.resetTime };
  }

  public isBlocked(key: string): boolean {
    const now = Date.now();
    const record = this.store.get(key);
    if (!record) return false;
    if (now > record.resetTime) {
      this.store.delete(key);
      return false;
    }
    return record.count >= this.maxRequests;
  }

  public reset(key: string) {
    this.store.delete(key);
  }

  public clear(): void {
    this.store.clear();
  }

  public middleware(keyPrefix: string) {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      const ip = request.ip || request.socket.remoteAddress || 'unknown';
      const key = `${keyPrefix}:${ip}`;
      const result = this.check(key);

      reply.header('X-RateLimit-Limit', this.maxRequests);
      reply.header('X-RateLimit-Remaining', result.remaining);
      reply.header('X-RateLimit-Reset', Math.ceil(result.resetTime / 1000));

      if (!result.allowed) {
        return reply.status(429).send({
          statusCode: 429,
          error: 'Too Many Requests',
          message: 'Rate limit exceeded. Please wait before trying again.',
          retryAfterSec: Math.ceil((result.resetTime - Date.now()) / 1000)
        });
      }
    };
  }
}

const isTest = process.env.NODE_ENV === 'test' || 
  process.argv.some(arg => arg.includes('--test') || arg.includes('test')) ||
  process.execArgv.some(arg => arg.includes('--test'));

// Global rate limiter instances with strict production security thresholds
export const loginRateLimiter = new TokenBucketRateLimiter(isTest ? 1000 : 5, 60 * 1000); // 5 attempts per min
export const registerRateLimiter = new TokenBucketRateLimiter(isTest ? 1000 : 3, 5 * 60 * 1000); // 3 registrations per 5 min
export const pinLookupRateLimiter = new TokenBucketRateLimiter(isTest ? 1000 : 5, 60 * 1000); // 5 PIN lookups per min
export const generalApiRateLimiter = new TokenBucketRateLimiter(isTest ? 5000 : 100, 60 * 1000); // 100 general requests per min
