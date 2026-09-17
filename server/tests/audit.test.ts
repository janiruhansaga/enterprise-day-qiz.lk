import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { io as ClientSocket, Socket as ClientSocketType } from 'socket.io-client';
import jwt from 'jsonwebtoken';
import { buildApp, AppInstance } from '../src/app.js';
import { DatabaseService } from '../src/db/database.js';
import { loadSecurityConfig, securityConfig, UserRole } from '../src/config/security.js';
import { signAuthToken } from '../src/auth/crypto.js';

describe('Phase 13: Independent Security Audit Regression Test Suite', () => {
  let app: AppInstance;
  let db: DatabaseService;
  let serverAddress: string;

  let teacherToken: string;
  let teacherId: string;
  let studentToken: string;

  let quizId: string;
  let questionId: string;
  let correctOptionId: string;
  let gamePin: string;
  let gameSessionId: string;

  let teacherSocket: ClientSocketType;
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
        email: 'audit_teacher@school.edu',
        password: 'Password12345',
        displayName: 'AuditTeacher',
        requestedRole: UserRole.TEACHER,
        invitationCode: securityConfig.teacherRegistrationSecret
      }
    });
    const tJson = JSON.parse(resT.body);
    teacherToken = tJson.token;
    teacherId = tJson.user.id;

    // Register Student
    const resS = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'audit_student@school.edu',
        password: 'Password12345',
        displayName: 'AuditStudent',
        requestedRole: UserRole.STUDENT
      }
    });
    studentToken = JSON.parse(resS.body).token;

    // Create Quiz
    const resQ = await app.inject({
      method: 'POST',
      url: '/api/v1/quizzes',
      headers: { authorization: `Bearer ${teacherToken}` },
      payload: { title: 'Audit Verification Quiz', description: 'Testing post-audit controls' }
    });
    quizId = JSON.parse(resQ.body).quiz.id;

    // Add Question
    const resQ1 = await app.inject({
      method: 'POST',
      url: `/api/v1/quizzes/${quizId}/questions`,
      headers: { authorization: `Bearer ${teacherToken}` },
      payload: {
        prompt: 'Is zero-trust verification continuous?',
        timeLimitSec: 20,
        basePoints: 1000,
        options: [
          { optionText: 'Yes, never trust, always verify', isCorrect: true },
          { optionText: 'No, trust on login', isCorrect: false }
        ]
      }
    });
    questionId = JSON.parse(resQ1.body).question.id;
    correctOptionId = db.getSecretAnswerKey(questionId)!.correctOptionId;

    // Host Game Session
    const resG = await app.inject({
      method: 'POST',
      url: '/api/v1/games',
      headers: { authorization: `Bearer ${teacherToken}` },
      payload: { quizId }
    });
    const gJson = JSON.parse(resG.body);
    gamePin = gJson.session.pin;
    gameSessionId = gJson.session.id;

    // Connect Teacher Socket
    teacherSocket = ClientSocket(serverAddress, { transports: ['websocket'] });
    await new Promise((resolve) => {
      teacherSocket.on('game:teacher_ready', resolve);
      teacherSocket.emit('game:teacher_join', { sessionId: gameSessionId, token: teacherToken });
    });

    clientSocket = ClientSocket(serverAddress, { transports: ['websocket'] });
    await new Promise((resolve) => clientSocket.on('connect', () => resolve(undefined)));
  });

  after(async () => {
    app.gameSocketManager?.getGameEngine().clearSessionTimer(gameSessionId);
    if (clientSocket?.connected) clientSocket.disconnect();
    if (teacherSocket?.connected) teacherSocket.disconnect();
    await app.close();
    db.close();
  });

  // =========================================================================
  // AUDIT-01: Production Configuration Hardening
  // =========================================================================
  describe('AUDIT-01: Production Configuration Hardening', () => {
    it('fails startup in production if JWT_SECRET is missing', () => {
      assert.throws(
        () => loadSecurityConfig({ NODE_ENV: 'production' }),
        /FATAL: JWT_SECRET environment variable must be set in production/
      );
    });

    it('fails startup in production if TEACHER_REGISTRATION_SECRET is missing', () => {
      assert.throws(
        () => loadSecurityConfig({
          NODE_ENV: 'production',
          JWT_SECRET: 'production_secret_32_characters_minimum!'
        }),
        /FATAL: TEACHER_REGISTRATION_SECRET environment variable must be set in production/
      );
    });

    it('fails startup in production if ADMIN_REGISTRATION_SECRET is missing', () => {
      assert.throws(
        () => loadSecurityConfig({
          NODE_ENV: 'production',
          JWT_SECRET: 'production_secret_32_characters_minimum!',
          TEACHER_REGISTRATION_SECRET: 'custom_teacher_secret'
        }),
        /FATAL: ADMIN_REGISTRATION_SECRET environment variable must be set in production/
      );
    });

    it('successfully loads production configuration when all required secrets are provided', () => {
      const cfg = loadSecurityConfig({
        NODE_ENV: 'production',
        JWT_SECRET: 'production_secret_32_characters_minimum!',
        TEACHER_REGISTRATION_SECRET: 'custom_teacher_secret',
        ADMIN_REGISTRATION_SECRET: 'custom_admin_secret'
      });

      assert.equal(cfg.isProduction, true);
      assert.equal(cfg.jwtSecret, 'production_secret_32_characters_minimum!');
      assert.equal(cfg.teacherRegistrationSecret, 'custom_teacher_secret');
      assert.equal(cfg.adminRegistrationSecret, 'custom_admin_secret');
    });
  });

  // =========================================================================
  // AUDIT-02: WebSocket Game PIN Rate Limiting
  // =========================================================================
  describe('AUDIT-02: WebSocket Game PIN Rate Limiting', () => {
    it('throttles rapid invalid PIN attempts over WebSocket with TOO_MANY_REQUESTS', async () => {
      // Send 5 invalid PIN join requests
      for (let i = 1; i <= 5; i++) {
        const res = await new Promise<any>((resolve) => {
          clientSocket.emit('game:join', { pin: `99900${i}`, nickname: `Attacker${i}` }, resolve);
        });
        assert.equal(res.success, false);
        assert.equal(res.code, 'PIN_NOT_FOUND');
      }

      // 6th attempt must be throttled by the socket rate limiter
      const blockedRes = await new Promise<any>((resolve) => {
        clientSocket.emit('game:join', { pin: '999006', nickname: 'Attacker6' }, resolve);
      });

      assert.equal(blockedRes.success, false);
      assert.equal(blockedRes.code, 'TOO_MANY_REQUESTS');
      assert.ok(blockedRes.message.includes('Too many invalid PIN attempts'));
    });
  });

  // =========================================================================
  // AUDIT-03: Kicked Player Cannot Submit Answers
  // =========================================================================
  describe('AUDIT-03: Kicked Player Authorization Isolation', () => {
    it('prevents a kicked player from submitting an answer', async () => {
      // Reset rate limiter for clean join
      app.gameSocketManager!.getPinRateLimiter().clear();

      // Connect a second clean student socket
      const student2Socket = ClientSocket(serverAddress, { transports: ['websocket'] });
      await new Promise((r) => student2Socket.on('connect', () => r(undefined)));

      const joinRes = await new Promise<any>((resolve) => {
        student2Socket.emit('game:join', { pin: gamePin, nickname: 'KickedStudent' }, resolve);
      });
      assert.equal(joinRes.success, true);
      const kickedParticipantId = joinRes.participantId;

      // Teacher starts the game
      await new Promise<any>((resolve) => {
        teacherSocket.emit('game:start_game', { sessionId: gameSessionId }, resolve);
      });

      const session = db.findSessionById(gameSessionId);
      const activeNonce = session.round_nonce;

      // Teacher kicks the student
      const kickRes = await new Promise<any>((resolve) => {
        teacherSocket.emit('game:kick_participant', { sessionId: gameSessionId, participantId: kickedParticipantId }, resolve);
      });
      assert.equal(kickRes.success, true);

      // Verify participant is removed from database
      const pInDb = db.getParticipant(kickedParticipantId);
      assert.equal(pInDb, null, 'Kicked participant must be deleted from DB');

      // Attempt to submit answer as kicked player via authoritative scoring engine
      const scoringEngine = app.gameSocketManager!.getScoringEngine();
      const submitResult = await scoringEngine.submitAnswer({
        sessionId: gameSessionId,
        participantId: kickedParticipantId,
        questionId,
        selectedOptionId: correctOptionId,
        roundNonce: activeNonce!,
        serverReceivedTime: Date.now()
      });

      assert.equal(submitResult.success, false);
      assert.equal(submitResult.code, 'PARTICIPANT_NOT_ACTIVE');

      student2Socket.disconnect();
    });
  });

  // =========================================================================
  // AUDIT-04: Token Revocation after Logout
  // =========================================================================
  describe('AUDIT-04: Server-Side Token Revocation on Logout', () => {
    it('invalidates a token immediately upon logout, blocking subsequent protected requests', async () => {
      // 1. Teacher signs in to obtain a fresh token
      const loginRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: 'audit_teacher@school.edu',
          password: 'Password12345'
        }
      });
      assert.equal(loginRes.statusCode, 200);
      const freshToken = JSON.parse(loginRes.body).token;

      // 2. Verify token works on protected endpoint
      const meResBefore = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${freshToken}` }
      });
      assert.equal(meResBefore.statusCode, 200);

      // 3. User calls logout
      const logoutRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        headers: { authorization: `Bearer ${freshToken}` }
      });
      assert.equal(logoutRes.statusCode, 200);

      // 4. Attempt to use revoked token on protected endpoint
      const meResAfter = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${freshToken}` }
      });
      assert.equal(meResAfter.statusCode, 401);
      assert.equal(JSON.parse(meResAfter.body).message, 'Token has been revoked');

      // 5. Attempt to use revoked token on teacher quizzes endpoint
      const quizResAfter = await app.inject({
        method: 'GET',
        url: '/api/v1/quizzes',
        headers: { authorization: `Bearer ${freshToken}` }
      });
      assert.equal(quizResAfter.statusCode, 401);
      assert.equal(JSON.parse(quizResAfter.body).message, 'Token has been revoked');
    });
  });

  // =========================================================================
  // AUDIT-05: Safe Handling of Oversized Socket Payloads
  // =========================================================================
  describe('AUDIT-05: Oversized Socket Payload Resilience', () => {
    it('gracefully rejects oversized socket payloads without crashing the server', async () => {
      const hugeString = 'A'.repeat(150000); // 150KB oversized payload

      const errResponse = await new Promise<any>((resolve) => {
        clientSocket.emit('game:submit_answer', {
          sessionId: gameSessionId,
          questionId,
          selectedOptionId: correctOptionId,
          roundNonce: hugeString
        }, resolve);
      });

      assert.equal(errResponse.success, false);
      assert.ok(errResponse.code === 'INVALID_PAYLOAD' || errResponse.code === 'UNAUTHORIZED');

      // Verify the server is still healthy and responsive
      const healthRes = await app.inject({ method: 'GET', url: '/health' });
      assert.equal(healthRes.statusCode, 200);
      assert.equal(JSON.parse(healthRes.body).status, 'healthy');
    });
  });

  // =========================================================================
  // AUDIT-06: Forged Teacher Socket Connection Defense
  // =========================================================================
  describe('AUDIT-06: Forged Teacher Socket Defense', () => {
    it('rejects game:teacher_join when emitted with a student token', async () => {
      const res = await new Promise<any>((resolve) => {
        clientSocket.emit('game:teacher_join', { sessionId: gameSessionId, token: studentToken }, resolve);
      });

      assert.equal(res.success, false);
      assert.equal(res.code, 'UNAUTHORIZED');
      assert.equal(res.message, 'Teacher authentication required');
    });

    it('rejects game:teacher_join when emitted with an untrusted arbitrary signed JWT', async () => {
      const forgedJwt = jwt.sign(
        { userId: teacherId, email: 'fake@school.edu', role: UserRole.TEACHER },
        'untrusted-fake-secret-key-123456789'
      );

      const res = await new Promise<any>((resolve) => {
        clientSocket.emit('game:teacher_join', { sessionId: gameSessionId, token: forgedJwt }, resolve);
      });

      assert.equal(res.success, false);
      assert.equal(res.code, 'UNAUTHORIZED');
    });

    it('rejects game:teacher_join when emitted with an expired JWT', async () => {
      const expiredJwt = jwt.sign(
        { userId: teacherId, email: 'audit_teacher@school.edu', role: UserRole.TEACHER },
        securityConfig.jwtSecret,
        { expiresIn: -10 } // Expired 10 seconds ago
      );

      const res = await new Promise<any>((resolve) => {
        clientSocket.emit('game:teacher_join', { sessionId: gameSessionId, token: expiredJwt }, resolve);
      });

      assert.equal(res.success, false);
      assert.equal(res.code, 'UNAUTHORIZED');
    });
  });
});
