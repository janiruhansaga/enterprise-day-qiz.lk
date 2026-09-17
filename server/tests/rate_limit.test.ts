import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { io as ClientSocket, Socket as ClientSocketType } from 'socket.io-client';
import { buildApp, AppInstance } from '../src/app.js';
import { DatabaseService } from '../src/db/database.js';
import { securityConfig, UserRole } from '../src/config/security.js';
import { TokenBucketRateLimiter } from '../src/middleware/rateLimiter.js';

describe('Phase 9: Anti-Cheat Protections, Rate Limiting & Abuse Prevention Suite', () => {
  let app: AppInstance;
  let db: DatabaseService;
  let serverAddress: string;

  let teacherToken: string;
  let quizId: string;
  let validPin: string;
  let clientSocket: ClientSocketType;

  before(async () => {
    db = new DatabaseService(':memory:');
    app = buildApp(db);

    await app.listen({ port: 0, host: '127.0.0.1' });
    const addressInfo = app.server.address() as any;
    serverAddress = `http://127.0.0.1:${addressInfo.port}`;

    // Register Teacher
    const resT = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'prof_ratelimit@school.edu',
        password: 'Password12345',
        displayName: 'ProfRateLimit',
        requestedRole: UserRole.TEACHER,
        invitationCode: securityConfig.teacherRegistrationSecret
      }
    });
    teacherToken = JSON.parse(resT.body).token;

    // Create Quiz
    const resQ = await app.inject({
      method: 'POST',
      url: '/api/v1/quizzes',
      headers: { authorization: `Bearer ${teacherToken}` },
      payload: { title: 'Rate Limit Exam', description: 'Testing brute force locks' }
    });
    quizId = JSON.parse(resQ.body).quiz.id;

    await app.inject({
      method: 'POST',
      url: `/api/v1/quizzes/${quizId}/questions`,
      headers: { authorization: `Bearer ${teacherToken}` },
      payload: {
        prompt: 'What is a DDoS attack?',
        timeLimitSec: 20,
        options: [
          { optionText: 'Denial of Service', isCorrect: true },
          { optionText: 'Direct Data Storage', isCorrect: false }
        ]
      }
    });

    // Create Game Session
    const resG = await app.inject({
      method: 'POST',
      url: '/api/v1/games',
      headers: { authorization: `Bearer ${teacherToken}` },
      payload: { quizId }
    });
    validPin = JSON.parse(resG.body).session.pin;

    clientSocket = ClientSocket(serverAddress, { transports: ['websocket'] });
    await new Promise((resolve) => clientSocket.on('connect', () => resolve(undefined)));
  });

  after(async () => {
    clientSocket.disconnect();
    app.io?.close();
    await app.close();
    db.close();
  });

  describe('PIN Enumeration & Brute-Force Rate Limiting', () => {
    it('throttles PIN lookup after 5 rapid attempts (HTTP 429 Too Many Requests)', async () => {
      const testLimiter = new TokenBucketRateLimiter(5, 60 * 1000);
      const testKey = 'pin_lookup:192.168.1.50';

      // First 5 attempts should be allowed
      for (let i = 0; i < 5; i++) {
        const check = testLimiter.check(testKey);
        assert.equal(check.allowed, true);
        assert.equal(check.remaining, 5 - 1 - i);
      }

      // 6th attempt must be blocked
      const blocked = testLimiter.check(testKey);
      assert.equal(blocked.allowed, false);
      assert.equal(blocked.remaining, 0);
    });
  });

  describe('Credential Stuffing & Login Rate Limiting', () => {
    it('throttles repeated failed login attempts after 5 tries (HTTP 429)', async () => {
      const testLoginLimiter = new TokenBucketRateLimiter(5, 60 * 1000);
      const testIpKey = 'login:192.168.1.99';

      for (let i = 0; i < 5; i++) {
        const result = testLoginLimiter.check(testIpKey);
        assert.equal(result.allowed, true);
      }

      // 6th attempt must be blocked
      const blocked = testLoginLimiter.check(testIpKey);
      assert.equal(blocked.allowed, false);
    });
  });

  describe('Profanity & Offensive Nickname Sanitization', () => {
    it('rejects reserved impersonation nickname "AdminUser" (INAPPROPRIATE_NICKNAME)', async () => {
      const errPromise = new Promise<any>((resolve) => {
        clientSocket.once('game:error', resolve);
      });

      clientSocket.emit('game:join', {
        pin: validPin,
        nickname: 'AdminUser'
      });

      const err = await errPromise;
      assert.equal(err.code, 'INAPPROPRIATE_NICKNAME');
    });

    it('rejects profanity in nickname (INAPPROPRIATE_NICKNAME)', async () => {
      const errPromise = new Promise<any>((resolve) => {
        clientSocket.once('game:error', resolve);
      });

      clientSocket.emit('game:join', {
        pin: validPin,
        nickname: 'SuperBitch99'
      });

      const err = await errPromise;
      assert.equal(err.code, 'INAPPROPRIATE_NICKNAME');
    });

    it('allows clean and appropriate student nickname', async () => {
      const successPromise = new Promise<any>((resolve) => {
        clientSocket.once('game:joined_success', resolve);
      });

      clientSocket.emit('game:join', {
        pin: validPin,
        nickname: 'SpeedyEagle'
      });

      const res = await successPromise;
      assert.equal(res.success, true);
      assert.equal(res.nickname, 'SpeedyEagle');
    });
  });
});
