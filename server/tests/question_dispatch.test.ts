import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { io as ClientSocket, Socket as ClientSocketType } from 'socket.io-client';
import { buildApp, AppInstance } from '../src/app.js';
import { DatabaseService } from '../src/db/database.js';
import { securityConfig, UserRole } from '../src/config/security.js';

describe('Phase 6: Server-Authoritative Question Dispatch & Zero-Answer Leakage Suite', () => {
  let app: AppInstance;
  let db: DatabaseService;
  let serverAddress: string;

  let teacherToken: string;
  let quizId: string;
  let gamePin: string;
  let gameSessionId: string;
  let teacherSocket: ClientSocketType;
  let studentSocket: ClientSocketType;

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
        email: 'prof_questions@school.edu',
        password: 'Password12345',
        displayName: 'ProfQuestions',
        requestedRole: UserRole.TEACHER,
        invitationCode: securityConfig.teacherRegistrationSecret
      }
    });
    teacherToken = JSON.parse(resT.body).token;

    // Create Quiz with 2 Questions (short time limit for fast tests)
    const resQ = await app.inject({
      method: 'POST',
      url: '/api/v1/quizzes',
      headers: { authorization: `Bearer ${teacherToken}` },
      payload: { title: 'Network Security 101', description: 'Examining payload leaks' }
    });
    quizId = JSON.parse(resQ.body).quiz.id;

    // Question 1: 2 seconds time limit for test speed
    await app.inject({
      method: 'POST',
      url: `/api/v1/quizzes/${quizId}/questions`,
      headers: { authorization: `Bearer ${teacherToken}` },
      payload: {
        prompt: 'What port does HTTPS use by default?',
        timeLimitSec: 5,
        basePoints: 1000,
        options: [
          { optionText: '80', isCorrect: false },
          { optionText: '443', isCorrect: true }, // Correct option
          { optionText: '22', isCorrect: false },
          { optionText: '25', isCorrect: false }
        ]
      }
    });

    // Question 2
    await app.inject({
      method: 'POST',
      url: `/api/v1/quizzes/${quizId}/questions`,
      headers: { authorization: `Bearer ${teacherToken}` },
      payload: {
        prompt: 'Which protocol is connection-oriented?',
        timeLimitSec: 5,
        basePoints: 1000,
        options: [
          { optionText: 'TCP', isCorrect: true }, // Correct option
          { optionText: 'UDP', isCorrect: false }
        ]
      }
    });

    // Create Game Session
    const resGame = await app.inject({
      method: 'POST',
      url: '/api/v1/games',
      headers: { authorization: `Bearer ${teacherToken}` },
      payload: { quizId }
    });
    const gameJson = JSON.parse(resGame.body);
    gamePin = gameJson.session.pin;
    gameSessionId = gameJson.session.id;

    // Connect Teacher Socket
    teacherSocket = ClientSocket(serverAddress, { transports: ['websocket'] });
    await new Promise((resolve) => {
      teacherSocket.on('game:teacher_ready', resolve);
      teacherSocket.emit('game:teacher_join', {
        sessionId: gameSessionId,
        token: teacherToken
      });
    });

    // Connect Student Socket
    studentSocket = ClientSocket(serverAddress, { transports: ['websocket'] });
    await new Promise((resolve) => {
      studentSocket.on('game:joined_success', resolve);
      studentSocket.emit('game:join', {
        pin: gamePin,
        nickname: 'StudentDave'
      });
    });
  });

  after(async () => {
    app.gameSocketManager?.getGameEngine().clearSessionTimer(gameSessionId);
    if (studentSocket?.connected) studentSocket.disconnect();
    if (teacherSocket?.connected) teacherSocket.disconnect();
    await app.close();
    db.close();
  });

  describe('RBAC & Game Progression Controls', () => {
    it('blocks student attempting to emit game:start_game (FORBIDDEN)', async () => {
      const errPromise = new Promise((resolve) => {
        studentSocket.once('game:error', resolve);
      });

      studentSocket.emit('game:start_game', { sessionId: gameSessionId });
      const err = (await errPromise) as any;
      assert.equal(err.code, 'FORBIDDEN');
    });

    it('blocks student attempting to emit game:next_question (FORBIDDEN)', async () => {
      const errPromise = new Promise((resolve) => {
        studentSocket.once('game:error', resolve);
      });

      studentSocket.emit('game:next_question', { sessionId: gameSessionId });
      const err = (await errPromise) as any;
      assert.equal(err.code, 'FORBIDDEN');
    });
  });

  describe('Zero-Trust Question Payload Sanitization', () => {
    let receivedQuestion: any;

    it('teacher starts the game, student receives strictly sanitized question payload', async () => {
      const questionPromise = new Promise((resolve) => {
        studentSocket.on('game:question_started', resolve);
      });

      teacherSocket.emit('game:start_game', { sessionId: gameSessionId });
      receivedQuestion = await questionPromise;

      assert.ok(receivedQuestion);
      assert.equal(receivedQuestion.questionIndex, 0);
      assert.equal(receivedQuestion.prompt, 'What port does HTTPS use by default?');
      assert.equal(receivedQuestion.totalQuestions, 2);
      assert.equal(receivedQuestion.options.length, 4);
      assert.ok(receivedQuestion.roundNonce);
      assert.ok(receivedQuestion.serverStartTime);
      assert.ok(receivedQuestion.serverDeadline);
    });

    it('CRITICAL ANTI-CHEAT: verified zero is_correct fields in student options payload', () => {
      // Deep inspect all received options in the client packet
      for (const opt of receivedQuestion.options) {
        assert.equal(opt.is_correct, undefined, 'CRITICAL LEAK: is_correct found in student option!');
        assert.equal(opt.isCorrect, undefined, 'CRITICAL LEAK: isCorrect found in student option!');
        assert.ok(opt.id, 'Option id must be provided');
        assert.ok(opt.option_text, 'Option text must be provided');
      }

      // Verify no answer key exists in top-level payload
      assert.equal(receivedQuestion.correctOptionId, undefined);
      assert.equal(receivedQuestion.answerKey, undefined);
      assert.equal(receivedQuestion.correctOptionIndex, undefined);
    });

    it('CRITICAL ANTI-CHEAT: verified future questions are NOT leaked in payload', () => {
      // Verify Question 2 is nowhere in the client packet
      const stringified = JSON.stringify(receivedQuestion);
      assert.equal(stringified.includes('TCP'), false, 'Future question leaked in payload!');
      assert.equal(stringified.includes('Which protocol is connection-oriented?'), false);
    });
  });

  describe('Server-Authoritative Timing & Answer Reveal', () => {
    it('server reveals the correct answer only after the question ends', async () => {
      // Trigger question expiration handler to simulate timer expiry
      const gameEngine = app.gameSocketManager!.getGameEngine();
      
      const questionEndedPromise = new Promise((resolve) => {
        studentSocket.on('game:question_ended', resolve);
      });

      const questionId = await receivedQuestionId(app, gameSessionId);
      gameEngine.handleQuestionTimerExpired(gameSessionId, questionId);
      const endedData = (await questionEndedPromise) as any;

      assert.ok(endedData);
      assert.ok(endedData.correctOptionId);
      assert.equal(endedData.reason, 'TIME_EXPIRED');

      // Verify revealed option corresponds to '443'
      const secretKey = db.getSecretAnswerKey(endedData.questionId);
      assert.equal(endedData.correctOptionId, secretKey!.correctOptionId);
    });
  });

  describe('Regression: Complete Teacher-Start -> Lobby-Transition Flow', () => {
    let regSessionId: string;
    let regGamePin: string;
    let regTeacherSocket: ClientSocketType;
    let regStudentSocket: ClientSocketType;
    let regParticipantId: string;

    after(() => {
      app.gameSocketManager?.getGameEngine().clearSessionTimer(regSessionId);
      if (regStudentSocket?.connected) regStudentSocket.disconnect();
      if (regTeacherSocket?.connected) regTeacherSocket.disconnect();
    });

    it('teacher starts game -> server updates state to QUESTION_ACTIVE -> student receives question -> student UI transitions from lobby to active question', async () => {
      // 1. Create fresh game session
      const resGame = await app.inject({
        method: 'POST',
        url: '/api/v1/games',
        headers: { authorization: `Bearer ${teacherToken}` },
        payload: { quizId }
      });
      assert.equal(resGame.statusCode, 201);
      const gameJson = JSON.parse(resGame.body);
      regGamePin = gameJson.session.pin;
      regSessionId = gameJson.session.id;

      // 2. Connect teacher socket to session room
      regTeacherSocket = ClientSocket(serverAddress, { transports: ['websocket'] });
      await new Promise((resolve) => {
        regTeacherSocket.on('game:teacher_ready', resolve);
        regTeacherSocket.emit('game:teacher_join', {
          sessionId: regSessionId,
          token: teacherToken
        });
      });

      // 3. Connect student socket and join session lobby
      regStudentSocket = ClientSocket(serverAddress, { transports: ['websocket'] });
      const joinData = await new Promise((resolve) => {
        regStudentSocket.on('game:joined_success', resolve);
        regStudentSocket.emit('game:join', {
          pin: regGamePin,
          nickname: 'RegStudent'
        });
      }) as any;

      assert.equal(joinData.success, true);
      assert.equal(joinData.sessionId, regSessionId);
      assert.ok(joinData.participantId);
      regParticipantId = joinData.participantId;

      // 4. Student is currently at STUDENT_LOBBY view
      let studentView = 'STUDENT_LOBBY';
      let studentCurrentQuestion: any = null;

      // Register client-side socket listener (exact implementation in App.tsx)
      const questionReceivedPromise = new Promise<any>((resolve) => {
        regStudentSocket.on('game:question_started', (q: any) => {
          const normalizedQuestion = {
            questionId: q.questionId,
            questionIndex: q.questionIndex,
            totalQuestions: q.totalQuestions,
            prompt: q.prompt || q.questionText || '',
            durationSec: q.durationSec ?? q.timeLimitSec ?? 20,
            serverStartTime: q.serverStartTime || Date.now(),
            roundNonce: q.roundNonce || '',
            options: (q.options || []).map((opt: any) => ({
              id: opt.id,
              optionText: opt.optionText || opt.option_text || ''
            }))
          };
          studentCurrentQuestion = normalizedQuestion;
          studentView = 'QUESTION';
          resolve(normalizedQuestion);
        });
      });

      // Confirm DB session is in LOBBY
      const initialDbSession = await db.findSessionById(regSessionId);
      assert.equal(initialDbSession?.status, 'LOBBY');

      // 5. Teacher clicks "Start Game" -> emits game:start_game
      const startAck = await new Promise<any>((resolve) => {
        regTeacherSocket.emit('game:start_game', { sessionId: regSessionId, token: teacherToken }, resolve);
      });
      assert.equal(startAck.success, true);
      assert.equal(startAck.questionIndex, 0);

      // 6. Verify server authoritative state transition: LOBBY -> QUESTION_ACTIVE
      const activeDbSession = await db.findSessionById(regSessionId);
      assert.equal(activeDbSession?.status, 'QUESTION_ACTIVE');
      assert.equal(activeDbSession?.current_question_index, 0);
      assert.ok(activeDbSession?.current_question_id);
      assert.ok(activeDbSession?.round_nonce);

      // 7. Student socket receives game:question_started and transitions UI state
      const receivedQuestion = await questionReceivedPromise;
      assert.ok(receivedQuestion);
      assert.equal(studentView, 'QUESTION'); // Successfully transitioned from lobby to active question!
      assert.equal(studentCurrentQuestion.questionIndex, 0);
      assert.equal(studentCurrentQuestion.prompt, 'What port does HTTPS use by default?');
      assert.equal(studentCurrentQuestion.durationSec, 5);
      assert.equal(typeof studentCurrentQuestion.durationSec, 'number');
      assert.ok(!isNaN(studentCurrentQuestion.durationSec));
      assert.equal(studentCurrentQuestion.options.length, 4);

      for (const opt of studentCurrentQuestion.options) {
        assert.ok(opt.id);
        assert.ok(opt.optionText.length > 0);
        // Anti-cheat verification: answers strictly withheld
        assert.equal(opt.isCorrect, undefined);
        assert.equal(opt.is_correct, undefined);
      }
    });

    it('student reconnects during QUESTION_ACTIVE and seamlessly recovers active question state', async () => {
      // Create a fresh socket simulating client re-connection after disconnect
      const reconnectSocket = ClientSocket(serverAddress, { transports: ['websocket'] });

      const questionStartedOnReconnect = new Promise<any>((resolve) => {
        reconnectSocket.on('game:question_started', resolve);
      });

      const reconnectAck = await new Promise<any>((resolve) => {
        reconnectSocket.emit('game:reconnect', {
          sessionId: regSessionId,
          participantId: regParticipantId
        }, resolve);
      });

      assert.equal(reconnectAck.success, true);
      assert.equal(reconnectAck.status, 'QUESTION_ACTIVE');
      assert.ok(reconnectAck.currentQuestion);

      const receivedQuestion = await questionStartedOnReconnect;
      assert.ok(receivedQuestion);
      assert.equal(receivedQuestion.questionIndex, 0);
      assert.equal(receivedQuestion.prompt, 'What port does HTTPS use by default?');

      reconnectSocket.disconnect();
    });
  });
});

async function receivedQuestionId(app: AppInstance, sessionId: string): Promise<string> {
  const session = await app.gameSocketManager!['db'].findSessionById(sessionId);
  return session!.current_question_id;
}
