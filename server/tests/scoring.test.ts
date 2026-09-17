import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { io as ClientSocket, Socket as ClientSocketType } from 'socket.io-client';
import { buildApp, AppInstance } from '../src/app.js';
import { DatabaseService } from '../src/db/database.js';
import { securityConfig, UserRole } from '../src/config/security.js';

describe('Phase 7: Server-Authoritative Scoring & Anti-Cheat Suite', () => {
  let app: AppInstance;
  let db: DatabaseService;
  let serverAddress: string;

  let teacherToken: string;
  let quizId: string;
  let gamePin: string;
  let gameSessionId: string;
  let teacherSocket: ClientSocketType;
  let studentSocket1: ClientSocketType;
  let student1ParticipantId: string;

  let question1Id: string;
  let correctOption1Id: string;
  let wrongOption1Id: string;
  let currentRoundNonce: string;

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
        email: 'prof_scoring@school.edu',
        password: 'Password12345',
        displayName: 'ProfScoring',
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
      payload: { title: 'Scoring Engine Exam', description: 'Testing scoring math & defenses' }
    });
    quizId = JSON.parse(resQ.body).quiz.id;

    // Add Question 1
    const resQ1 = await app.inject({
      method: 'POST',
      url: `/api/v1/quizzes/${quizId}/questions`,
      headers: { authorization: `Bearer ${teacherToken}` },
      payload: {
        prompt: 'Which hashing algorithm is memory-hard?',
        timeLimitSec: 20,
        basePoints: 1000,
        options: [
          { optionText: 'MD5', isCorrect: false },
          { optionText: 'Argon2 / scrypt', isCorrect: true }, // Correct option
          { optionText: 'SHA-1', isCorrect: false }
        ]
      }
    });
    question1Id = JSON.parse(resQ1.body).question.id;

    // Retrieve option IDs from DB for test verification
    const secretKey = db.getSecretAnswerKey(question1Id);
    correctOption1Id = secretKey!.correctOptionId;

    const publicQ = db.getPublicQuestionForStudent(question1Id);
    const wrongOpt = publicQ!.options.find(o => o.id !== correctOption1Id);
    wrongOption1Id = wrongOpt!.id;

    // Host Game Session
    const resGame = await app.inject({
      method: 'POST',
      url: '/api/v1/games',
      headers: { authorization: `Bearer ${teacherToken}` },
      payload: { quizId }
    });
    const gameJson = JSON.parse(resGame.body);
    gamePin = gameJson.session.pin;
    gameSessionId = gameJson.session.id;

    // Connect Teacher
    teacherSocket = ClientSocket(serverAddress, { transports: ['websocket'] });
    await new Promise((resolve) => {
      teacherSocket.on('game:teacher_ready', resolve);
      teacherSocket.emit('game:teacher_join', { sessionId: gameSessionId, token: teacherToken });
    });

    // Connect Student 1
    studentSocket1 = ClientSocket(serverAddress, { transports: ['websocket'] });
    const joinRes = await new Promise<any>((resolve) => {
      studentSocket1.on('game:joined_success', resolve);
      studentSocket1.emit('game:join', { pin: gamePin, nickname: 'HackerStudent' });
    });
    student1ParticipantId = joinRes.participantId;

    // Start Game
    const qStartedPromise = new Promise<any>((resolve) => {
      studentSocket1.on('game:question_started', resolve);
    });
    teacherSocket.emit('game:start_game', { sessionId: gameSessionId });
    const qStarted = await qStartedPromise;
    currentRoundNonce = qStarted.roundNonce;
  });

  after(async () => {
    app.gameSocketManager?.getGameEngine().clearSessionTimer(gameSessionId);
    if (studentSocket1?.connected) studentSocket1.disconnect();
    if (teacherSocket?.connected) teacherSocket.disconnect();
    await app.close();
    db.close();
  });

  describe('Anti-Cheat: Nonce Verification & Replay Protection', () => {
    it('rejects answer submission with invalid round nonce', async () => {
      const errPromise = new Promise<any>((resolve) => {
        studentSocket1.once('game:error', resolve);
      });

      studentSocket1.emit('game:submit_answer', {
        sessionId: gameSessionId,
        questionId: question1Id,
        selectedOptionId: correctOption1Id,
        roundNonce: 'invalid-replayed-nonce-12345678'
      });

      const err = await errPromise;
      assert.equal(err.code, 'INVALID_NONCE');
    });
  });

  describe('Server-Side Correctness & Score Math', () => {
    it('accurately evaluates correct answer, calculates points, and updates score', async () => {
      const ackPromise = new Promise<any>((resolve) => {
        studentSocket1.on('game:answer_acknowledged', resolve);
      });

      studentSocket1.emit('game:submit_answer', {
        sessionId: gameSessionId,
        questionId: question1Id,
        selectedOptionId: correctOption1Id,
        roundNonce: currentRoundNonce
      });

      const ack = await ackPromise;
      assert.equal(ack.success, true);
      assert.equal(ack.questionId, question1Id);
      assert.ok(ack.totalScore > 0, 'Total score must be greater than 0');
      assert.equal(ack.streakCount, 1);

      // Verify in DB directly
      const p = db.getParticipant(student1ParticipantId);
      assert.equal(p.total_score, ack.totalScore);
      assert.equal(p.streak_count, 1);
    });
  });

  describe('Anti-Cheat: Duplicate Submission & Race Condition Defense', () => {
    it('blocks second answer submission for same question (DUPLICATE_ANSWER)', async () => {
      // Ensure session remains in active state for duplicate answer check
      db.updateSessionState(gameSessionId, { status: 'QUESTION_ACTIVE' });

      const errPromise = new Promise<any>((resolve) => {
        studentSocket1.once('game:error', resolve);
      });

      // Attempt second submission
      studentSocket1.emit('game:submit_answer', {
        sessionId: gameSessionId,
        questionId: question1Id,
        selectedOptionId: wrongOption1Id,
        roundNonce: currentRoundNonce
      });

      const err = await errPromise;
      assert.equal(err.code, 'DUPLICATE_ANSWER');
    });

    it('blocks burst of 10 concurrent answer submissions via atomic lock and database constraints', async () => {
      // Ensure session is in active state
      db.updateSessionState(gameSessionId, { status: 'QUESTION_ACTIVE' });
      const scoringEngine = app.gameSocketManager!.getScoringEngine();
      const dummyParticipantId = '00000000-0000-0000-0000-000000000099';

      db.addParticipant({
        id: dummyParticipantId,
        session_id: gameSessionId,
        nickname: 'BurstBot',
        joined_at: Date.now()
      });

      // Fire 10 parallel asynchronous submissions at the exact same millisecond
      const promises = Array.from({ length: 10 }, () =>
        scoringEngine.submitAnswer({
          sessionId: gameSessionId,
          participantId: dummyParticipantId,
          questionId: question1Id,
          selectedOptionId: correctOption1Id,
          roundNonce: currentRoundNonce,
          serverReceivedTime: Date.now()
        })
      );

      const results = await Promise.all(promises);
      const successes = results.filter(r => r.success);
      const duplicates = results.filter(r => r.code === 'DUPLICATE_ANSWER');

      // CRITICAL ASSERTION: Exactly ONE submission succeeded, exactly 9 were blocked
      assert.equal(successes.length, 1, 'Exactly one concurrent submission must succeed');
      assert.equal(duplicates.length, 9, 'All duplicate concurrent submissions must be blocked');
    });
  });

  describe('Server-Side Deadline Enforcement', () => {
    it('rejects answers arriving after deadline + 500ms grace period', async () => {
      // Ensure session is active
      db.updateSessionState(gameSessionId, { status: 'QUESTION_ACTIVE' });
      const scoringEngine = app.gameSocketManager!.getScoringEngine();
      const lateParticipantId = '00000000-0000-0000-0000-000000000088';

      db.addParticipant({
        id: lateParticipantId,
        session_id: gameSessionId,
        nickname: 'LateStudent',
        joined_at: Date.now()
      });

      const session = db.findSessionById(gameSessionId);
      const lateTime = (session.question_deadline || Date.now()) + 2000; // 2 seconds late

      const result = await scoringEngine.submitAnswer({
        sessionId: gameSessionId,
        participantId: lateParticipantId,
        questionId: question1Id,
        selectedOptionId: correctOption1Id,
        roundNonce: currentRoundNonce,
        serverReceivedTime: lateTime
      });

      assert.equal(result.success, false);
      assert.equal(result.code, 'DEADLINE_EXCEEDED');
    });
  });
});
