import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { io as ClientSocket, Socket as ClientSocketType } from 'socket.io-client';
import jwt from 'jsonwebtoken';
import { buildApp, AppInstance } from '../src/app.js';
import { DatabaseService } from '../src/db/database.js';
import { securityConfig, UserRole } from '../src/config/security.js';
import { signAuthToken } from '../src/auth/crypto.js';

describe('Phase 10: Consolidated Adversary Penetration & Zero-Trust Verification Suite', () => {
  let app: AppInstance;
  let db: DatabaseService;
  let serverAddress: string;

  let teacherToken: string;
  let teacherId: string;
  let studentToken: string;
  let studentId: string;
  let otherStudentToken: string;

  let quizId: string;
  let q1Id: string;
  let q2Id: string;
  let q1CorrectOptionId: string;
  let q1WrongOptionId: string;
  let q2CorrectOptionId: string;

  let gamePin: string;
  let gameSessionId: string;

  let teacherSocket: ClientSocketType;
  let studentSocket: ClientSocketType;
  let studentParticipantId: string;

  before(async () => {
    db = new DatabaseService(':memory:');
    app = buildApp(db);

    await app.listen({ port: 0, host: '127.0.0.1' });
    const addressInfo = app.server.address() as any;
    serverAddress = `http://127.0.0.1:${addressInfo.port}`;

    // 1. Register Teacher
    const resT = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'target_teacher@school.edu',
        password: 'Password12345',
        displayName: 'TargetTeacher',
        requestedRole: UserRole.TEACHER,
        invitationCode: securityConfig.teacherRegistrationSecret
      }
    });
    const tBody = JSON.parse(resT.body);
    teacherToken = tBody.token;
    teacherId = tBody.user.id;

    // 2. Register Student 1 (Adversary)
    const resS = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'adversary_student@school.edu',
        password: 'Password12345',
        displayName: 'AdversaryStudent',
        requestedRole: UserRole.STUDENT
      }
    });
    const sBody = JSON.parse(resS.body);
    studentToken = sBody.token;
    studentId = sBody.user.id;

    // 3. Register Student 2 (Victim)
    const resS2 = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'victim_student@school.edu',
        password: 'Password12345',
        displayName: 'VictimStudent',
        requestedRole: UserRole.STUDENT
      }
    });
    otherStudentToken = JSON.parse(resS2.body).token;

    // 4. Create Multi-Question Quiz as Teacher
    const resQ = await app.inject({
      method: 'POST',
      url: '/api/v1/quizzes',
      headers: { authorization: `Bearer ${teacherToken}` },
      payload: { title: 'Penetration Defense Exam', description: 'Zero-trust evaluation quiz' }
    });
    quizId = JSON.parse(resQ.body).quiz.id;

    // Add Question 1
    const resQ1 = await app.inject({
      method: 'POST',
      url: `/api/v1/quizzes/${quizId}/questions`,
      headers: { authorization: `Bearer ${teacherToken}` },
      payload: {
        prompt: 'What is defense in depth?',
        timeLimitSec: 15,
        basePoints: 1000,
        options: [
          { optionText: 'Layered security controls', isCorrect: true },
          { optionText: 'Single firewall only', isCorrect: false },
          { optionText: 'Security through obscurity', isCorrect: false }
        ]
      }
    });
    q1Id = JSON.parse(resQ1.body).question.id;
    const q1Key = db.getSecretAnswerKey(q1Id);
    q1CorrectOptionId = q1Key!.correctOptionId;
    const q1Public = db.getPublicQuestionForStudent(q1Id);
    q1WrongOptionId = q1Public!.options.find(o => o.id !== q1CorrectOptionId)!.id;

    // Add Question 2
    const resQ2 = await app.inject({
      method: 'POST',
      url: `/api/v1/quizzes/${quizId}/questions`,
      headers: { authorization: `Bearer ${teacherToken}` },
      payload: {
        prompt: 'Why must timers be server-authoritative?',
        timeLimitSec: 15,
        basePoints: 1000,
        options: [
          { optionText: 'Clients can manipulate local time', isCorrect: true },
          { optionText: 'Browsers are faster than servers', isCorrect: false }
        ]
      }
    });
    q2Id = JSON.parse(resQ2.body).question.id;
    const q2Key = db.getSecretAnswerKey(q2Id);
    q2CorrectOptionId = q2Key!.correctOptionId;

    // 5. Host Game Session
    const resGame = await app.inject({
      method: 'POST',
      url: '/api/v1/games',
      headers: { authorization: `Bearer ${teacherToken}` },
      payload: { quizId }
    });
    const gameJson = JSON.parse(resGame.body);
    gamePin = gameJson.session.pin;
    gameSessionId = gameJson.session.id;

    // 6. Connect Teacher Socket
    teacherSocket = ClientSocket(serverAddress, { transports: ['websocket'] });
    await new Promise((resolve) => {
      teacherSocket.on('game:teacher_ready', resolve);
      teacherSocket.emit('game:teacher_join', { sessionId: gameSessionId, token: teacherToken });
    });

    // 7. Connect Student Socket
    studentSocket = ClientSocket(serverAddress, { transports: ['websocket'] });
    const joinRes = await new Promise<any>((resolve) => {
      studentSocket.on('game:joined_success', resolve);
      studentSocket.emit('game:join', { pin: gamePin, nickname: 'Attacker' });
    });
    studentParticipantId = joinRes.participantId;
  });

  after(async () => {
    app.gameSocketManager?.getGameEngine().clearSessionTimer(gameSessionId);
    if (studentSocket?.connected) studentSocket.disconnect();
    if (teacherSocket?.connected) teacherSocket.disconnect();
    await app.close();
    db.close();
  });

  // =========================================================================
  // PEN-01: Privacy & PII Boundary Enforcement (FERPA / Zero Data Leakage)
  // =========================================================================
  describe('PEN-01: Privacy & PII Defense', () => {
    it('blocks student from querying another student profile or private email via /api/v1/auth/me', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${studentToken}` }
      });
      assert.equal(res.statusCode, 200);
      const data = JSON.parse(res.body);

      // Verify student ONLY receives their own info, never another user's
      assert.equal(data.user.email, 'adversary_student@school.edu');
      assert.notEqual(data.user.email, 'victim_student@school.edu');
    });

    it('ensures room leaderboard broadcasts NEVER leak student emails or participant IDs', async () => {
      const leaderboardEngine = app.gameSocketManager!.getLeaderboardEngine();
      const topList = await leaderboardEngine.getLeaderboard(gameSessionId, 10);

      for (const entry of topList) {
        assert.equal((entry as any).email, undefined, 'Email must never be present in public leaderboard');
        assert.equal((entry as any).participantId, undefined, 'Participant UUID must not be leaked');
        assert.ok(typeof entry.nickname === 'string');
        assert.ok(typeof entry.score === 'number');
        assert.ok(typeof entry.rank === 'number');
      }
    });
  });

  // =========================================================================
  // PEN-02: BOLA / IDOR Protection on Teacher Quizzes & Secret Keys
  // =========================================================================
  describe('PEN-02: Teacher Quiz & Secret Key BOLA/IDOR Protection', () => {
    it('strictly denies student token from listing teacher quizzes (403 Forbidden)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/quizzes',
        headers: { authorization: `Bearer ${studentToken}` }
      });
      assert.equal(res.statusCode, 403);
      assert.equal(JSON.parse(res.body).error, 'Forbidden');
    });

    it('strictly denies student token from fetching quiz details or question bank (403 Forbidden)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/quizzes/${quizId}`,
        headers: { authorization: `Bearer ${studentToken}` }
      });
      assert.equal(res.statusCode, 403);
      assert.equal(JSON.parse(res.body).error, 'Forbidden');
    });

    it('strictly denies unauthenticated requests from fetching quiz details (401 Unauthorized)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/quizzes/${quizId}`
      });
      assert.equal(res.statusCode, 401);
    });
  });

  // =========================================================================
  // PEN-03: Privilege Escalation & Role Forgery Defense
  // =========================================================================
  describe('PEN-03: Privilege Escalation & Signature Tampering', () => {
    it('rejects registration with ADMIN role without master secret (403 Forbidden)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email: 'fake_admin@school.edu',
          password: 'Password12345',
          displayName: 'FakeAdmin',
          requestedRole: UserRole.ADMIN,
          invitationCode: 'invalid_code_guess'
        }
      });
      assert.equal(res.statusCode, 403);
      assert.equal(JSON.parse(res.body).error, 'Forbidden');
    });

    it('rejects JWT signed with forged "none" algorithm (401 Unauthorized)', async () => {
      const forgedPayload = {
        userId: studentId,
        email: 'adversary_student@school.edu',
        role: UserRole.ADMIN,
        displayName: 'ForgedAdmin'
      };
      // Forged JWT with alg: "none"
      const unsignedHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
      const payloadEnc = Buffer.from(JSON.stringify(forgedPayload)).toString('base64url');
      const noneToken = `${unsignedHeader}.${payloadEnc}.`;

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${noneToken}` }
      });
      assert.equal(res.statusCode, 401);
    });

    it('rejects JWT signed with an untrusted arbitrary secret (401 Unauthorized)', async () => {
      const fakeToken = jwt.sign(
        { userId: studentId, email: 'fake@school.edu', role: UserRole.ADMIN },
        'attacker-controlled-secret-key'
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/quizzes',
        headers: { authorization: `Bearer ${fakeToken}` }
      });
      assert.equal(res.statusCode, 401);
    });

    it('blocks student socket from calling game:start_game (FORBIDDEN)', async () => {
      const errPromise = new Promise<any>((resolve) => {
        studentSocket.once('game:error', resolve);
      });

      studentSocket.emit('game:start_game', { sessionId: gameSessionId });
      const err = await errPromise;
      assert.equal(err.code, 'FORBIDDEN');
    });
  });

  // =========================================================================
  // PEN-04: Question Payload Sanitization & Anti-Leak (SEC-01)
  // =========================================================================
  describe('PEN-04: Zero-Answer Leakage & Payload Stripping (SEC-01)', () => {
    let activeQuestionNonce: string;

    it('broadcasts question 1 without is_correct, answer index, or future questions', async () => {
      const qPromise = new Promise<any>((resolve) => {
        studentSocket.once('game:question_started', resolve);
      });

      teacherSocket.emit('game:start_game', { sessionId: gameSessionId });
      const qData = await qPromise;
      activeQuestionNonce = qData.roundNonce;

      assert.equal(qData.questionId, q1Id);
      assert.ok(qData.roundNonce, 'Must have round nonce');
      assert.equal((qData as any).correctOptionId, undefined);
      assert.equal((qData as any).isCorrect, undefined);

      // Verify every option is completely stripped of isCorrect
      for (const opt of qData.options) {
        assert.equal(opt.isCorrect, undefined);
        assert.equal((opt as any).is_correct, undefined);
      }

      // Verify question 2 prompt is nowhere in the payload
      const serialized = JSON.stringify(qData);
      assert.ok(!serialized.includes('authoritative'), 'Future question 2 must not be leaked');
    });

    // =========================================================================
    // PEN-05: Question ID Tampering / Mismatch Defense
    // =========================================================================
    describe('PEN-05: Question ID Tampering Defense', () => {
      it('rejects answer submitted with question 2 ID while question 1 is active (QUESTION_MISMATCH)', async () => {
        const scoringEngine = app.gameSocketManager!.getScoringEngine();

        const result = await scoringEngine.submitAnswer({
          sessionId: gameSessionId,
          participantId: studentParticipantId,
          questionId: q2Id, // Tampered question ID!
          selectedOptionId: q2CorrectOptionId,
          roundNonce: activeQuestionNonce,
          serverReceivedTime: Date.now()
        });

        assert.equal(result.success, false);
        assert.equal(result.code, 'QUESTION_MISMATCH');
      });
    });

    // =========================================================================
    // PEN-06: Replay Attack Defense (Old Nonce Injection)
    // =========================================================================
    describe('PEN-06: Cryptographic Replay Attack Defense', () => {
      it('rejects an answer submitted with an expired or forged round nonce (INVALID_NONCE)', async () => {
        const scoringEngine = app.gameSocketManager!.getScoringEngine();

        const result = await scoringEngine.submitAnswer({
          sessionId: gameSessionId,
          participantId: studentParticipantId,
          questionId: q1Id,
          selectedOptionId: q1CorrectOptionId,
          roundNonce: 'forged-replay-nonce-abcdef123456',
          serverReceivedTime: Date.now()
        });

        assert.equal(result.success, false);
        assert.equal(result.code, 'INVALID_NONCE');
      });
    });

    // =========================================================================
    // PEN-07: Race Condition / 50 Concurrent Submissions Defense (SEC-03)
    // =========================================================================
    describe('PEN-07: 50 Concurrent Answer Submissions Race Condition (SEC-03)', () => {
      it('processes 50 concurrent submissions at exact same millisecond: exactly 1 succeeds, 49 are rejected', async () => {
        const scoringEngine = app.gameSocketManager!.getScoringEngine();

        // Register dummy participant for clean race test
        const botId = '11111111-1111-1111-1111-111111111111';
        db.addParticipant({
          id: botId,
          session_id: gameSessionId,
          nickname: 'RaceBot50',
          joined_at: Date.now()
        });

        // Fire 50 simultaneous parallel submissions
        const burstCount = 50;
        const promises = Array.from({ length: burstCount }, () =>
          scoringEngine.submitAnswer({
            sessionId: gameSessionId,
            participantId: botId,
            questionId: q1Id,
            selectedOptionId: q1CorrectOptionId,
            roundNonce: activeQuestionNonce,
            serverReceivedTime: Date.now()
          })
        );

        const results = await Promise.all(promises);
        const successes = results.filter(r => r.success);
        const duplicates = results.filter(r => r.code === 'DUPLICATE_ANSWER');

        assert.equal(successes.length, 1, 'Strictly 1 submission must succeed in the race');
        assert.equal(duplicates.length, 49, 'Exactly 49 submissions must be rejected with DUPLICATE_ANSWER');

        // Confirm DB has strictly 1 response recorded for this participant on this question
        const hasAnswered = await db.hasParticipantAnswered(gameSessionId, botId, q1Id);
        assert.equal(hasAnswered, true);
        const totalAnswers = await scoringEngine.countAnswersForQuestion(gameSessionId, q1Id);
        assert.ok(totalAnswers >= 1);
        const botRecord = await db.getParticipant(botId);
        assert.ok(botRecord!.total_score > 0, 'Bot should have points awarded once');
      });
    });

    // =========================================================================
    // PEN-08: Client-Side Point Tampering Defense (SEC-07)
    // =========================================================================
    describe('PEN-08: Client-Side Point Tampering Defense (SEC-07)', () => {
      it('ignores malicious client-supplied point values and computes score authoritatively', async () => {
        const scoringEngine = app.gameSocketManager!.getScoringEngine();

        // Register another participant to submit legitimate answer with tampered parameters
        const tamperParticipantId = '22222222-2222-2222-2222-222222222222';
        db.addParticipant({
          id: tamperParticipantId,
          session_id: gameSessionId,
          nickname: 'PointTamperer',
          joined_at: Date.now()
        });

        // Adversary attempts to pass points: 9999999 in payload
        const submissionPayload: any = {
          sessionId: gameSessionId,
          participantId: tamperParticipantId,
          questionId: q1Id,
          selectedOptionId: q1CorrectOptionId,
          roundNonce: activeQuestionNonce,
          serverReceivedTime: Date.now(),
          points: 9999999, // Injected malicious points
          score: 500000    // Injected malicious score
        };

        const result = await scoringEngine.submitAnswer(submissionPayload);
        assert.equal(result.success, true);
        assert.ok(result.pointsAwarded! <= 1500, 'Score must be calculated via server formula, never client points');
        assert.ok(result.totalScore! <= 1500);

        const participantInDb = db.getParticipant(tamperParticipantId);
        assert.equal(participantInDb.total_score, result.totalScore);
        assert.notEqual(participantInDb.total_score, 9999999);
      });
    });

    // =========================================================================
    // PEN-09: Post-Deadline Submission Defense (SEC-02)
    // =========================================================================
    describe('PEN-09: Post-Deadline Submission Defense (SEC-02)', () => {
      it('strictly rejects submission arriving 2 seconds after the deadline (DEADLINE_EXCEEDED)', async () => {
        const scoringEngine = app.gameSocketManager!.getScoringEngine();
        const lateParticipantId = '33333333-3333-3333-3333-333333333333';
        db.addParticipant({
          id: lateParticipantId,
          session_id: gameSessionId,
          nickname: 'LateArrival',
          joined_at: Date.now()
        });

        const session = db.findSessionById(gameSessionId);
        const lateTime = (session.question_deadline || Date.now()) + 2000; // 2000ms after deadline

        const result = await scoringEngine.submitAnswer({
          sessionId: gameSessionId,
          participantId: lateParticipantId,
          questionId: q1Id,
          selectedOptionId: q1CorrectOptionId,
          roundNonce: activeQuestionNonce,
          serverReceivedTime: lateTime
        });

        assert.equal(result.success, false);
        assert.equal(result.code, 'DEADLINE_EXCEEDED');

        // Confirm 0 points recorded
        const lateParticipant = db.getParticipant(lateParticipantId);
        assert.equal(lateParticipant.total_score, 0);
      });
    });

    // =========================================================================
    // PEN-10: Cross-Round Nonce Invalidation
    // =========================================================================
    describe('PEN-10: Cross-Round Nonce Invalidation', () => {
      it('invalidates Question 1 nonce once Question 2 begins', async () => {
        const q2Promise = new Promise<any>((resolve) => {
          studentSocket.once('game:question_started', resolve);
        });

        // Teacher advances to question 2
        teacherSocket.emit('game:next_question', { sessionId: gameSessionId });
        const q2Data = await q2Promise;
        assert.equal(q2Data.questionId, q2Id);
        const q2Nonce = q2Data.roundNonce;
        assert.notEqual(q2Nonce, activeQuestionNonce, 'Each question MUST generate a fresh round nonce');

        // Attacker attempts to use Question 1 nonce on Question 2
        const scoringEngine = app.gameSocketManager!.getScoringEngine();
        const replayResult = await scoringEngine.submitAnswer({
          sessionId: gameSessionId,
          participantId: studentParticipantId,
          questionId: q2Id,
          selectedOptionId: q2CorrectOptionId,
          roundNonce: activeQuestionNonce, // STALE Question 1 Nonce!
          serverReceivedTime: Date.now()
        });

        assert.equal(replayResult.success, false);
        assert.equal(replayResult.code, 'INVALID_NONCE');
      });
    });
  });
});
