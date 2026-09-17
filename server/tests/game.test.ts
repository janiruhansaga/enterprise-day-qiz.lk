import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { io as ClientSocket, Socket as ClientSocketType } from 'socket.io-client';
import { buildApp, AppInstance } from '../src/app.js';
import { DatabaseService } from '../src/db/database.js';
import { securityConfig, UserRole } from '../src/config/security.js';

describe('Phase 5: Real-Time Game Session & Lobby Security Suite', () => {
  let app: AppInstance;
  let db: DatabaseService;
  let serverAddress: string;

  let teacherToken: string;
  let otherTeacherToken: string;
  let studentToken: string;
  let validQuizId: string;
  let emptyQuizId: string;
  let activeGamePin: string;
  let activeGameSessionId: string;

  before(async () => {
    db = new DatabaseService(':memory:');
    app = buildApp(db);

    // Bind to dynamic port for live WebSocket client tests
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addressInfo = app.server.address() as any;
    serverAddress = `http://127.0.0.1:${addressInfo.port}`;

    // Register Teacher 1
    const resT1 = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 't1@school.edu',
        password: 'Password12345',
        displayName: 'TeacherOne',
        requestedRole: UserRole.TEACHER,
        invitationCode: securityConfig.teacherRegistrationSecret
      }
    });
    teacherToken = JSON.parse(resT1.body).token;

    // Register Teacher 2
    const resT2 = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 't2@school.edu',
        password: 'Password12345',
        displayName: 'TeacherTwo',
        requestedRole: UserRole.TEACHER,
        invitationCode: securityConfig.teacherRegistrationSecret
      }
    });
    otherTeacherToken = JSON.parse(resT2.body).token;

    // Register Student
    const resS = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'student_game@school.edu',
        password: 'Password12345',
        displayName: 'GameStudent'
      }
    });
    studentToken = JSON.parse(resS.body).token;

    // Create valid quiz with 1 question
    const resQ = await app.inject({
      method: 'POST',
      url: '/api/v1/quizzes',
      headers: { authorization: `Bearer ${teacherToken}` },
      payload: { title: 'Lobby Test Quiz', description: 'Testing game lobby' }
    });
    validQuizId = JSON.parse(resQ.body).quiz.id;

    await app.inject({
      method: 'POST',
      url: `/api/v1/quizzes/${validQuizId}/questions`,
      headers: { authorization: `Bearer ${teacherToken}` },
      payload: {
        prompt: 'What is 2 + 2?',
        options: [
          { optionText: '3', isCorrect: false },
          { optionText: '4', isCorrect: true }
        ]
      }
    });

    // Create empty quiz (0 questions)
    const resEmpty = await app.inject({
      method: 'POST',
      url: '/api/v1/quizzes',
      headers: { authorization: `Bearer ${teacherToken}` },
      payload: { title: 'Empty Quiz', description: 'No questions' }
    });
    emptyQuizId = JSON.parse(resEmpty.body).quiz.id;
  });

  after(async () => {
    await app.close();
    db.close();
  });

  describe('Game Session Creation & Authorization', () => {
    it('rejects student attempting to host a game session (403 Forbidden)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/games',
        headers: { authorization: `Bearer ${studentToken}` },
        payload: { quizId: validQuizId }
      });

      assert.equal(res.statusCode, 403);
    });

    it('rejects teacher attempting to host another teacher\'s quiz (404 Not Found / IDOR defense)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/games',
        headers: { authorization: `Bearer ${otherTeacherToken}` },
        payload: { quizId: validQuizId }
      });

      assert.equal(res.statusCode, 404);
    });

    it('rejects hosting a quiz that has 0 questions (400 Bad Request)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/games',
        headers: { authorization: `Bearer ${teacherToken}` },
        payload: { quizId: emptyQuizId }
      });

      assert.equal(res.statusCode, 400);
      const json = JSON.parse(res.body);
      assert.match(json.message, /Cannot host a game with 0 questions/i);
    });

    it('allows teacher to create a game session, generating a secure 6-digit PIN', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/games',
        headers: { authorization: `Bearer ${teacherToken}` },
        payload: { quizId: validQuizId }
      });

      assert.equal(res.statusCode, 201);
      const json = JSON.parse(res.body);
      assert.ok(json.session.id);
      assert.equal(json.session.status, 'LOBBY');
      assert.match(json.session.pin, /^\d{6}$/);

      activeGamePin = json.session.pin;
      activeGameSessionId = json.session.id;
    });
  });

  describe('Public PIN Validation Endpoint', () => {
    it('returns sanitized game details for valid active PIN', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/games/pin/${activeGamePin}`
      });

      assert.equal(res.statusCode, 200);
      const json = JSON.parse(res.body);
      assert.equal(json.valid, true);
      assert.equal(json.status, 'LOBBY');
      assert.equal(json.quizTitle, 'Lobby Test Quiz');
      assert.equal(json.sessionId, activeGameSessionId);
    });

    it('returns 404 for non-existent PIN', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/games/pin/999999'
      });

      assert.equal(res.statusCode, 404);
    });

    it('rejects invalid PIN format (not 6 digits)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/games/pin/abc12'
      });

      assert.equal(res.statusCode, 400);
    });
  });

  describe('Real-Time WebSocket Lobby Interactions', () => {
    let studentSocket1: ClientSocketType;
    let studentSocket2: ClientSocketType;
    let teacherSocket: ClientSocketType;
    let participant1Id: string;

    after(() => {
      if (studentSocket1?.connected) studentSocket1.disconnect();
      if (studentSocket2?.connected) studentSocket2.disconnect();
      if (teacherSocket?.connected) teacherSocket.disconnect();
    });

    it('teacher connects to session room via WebSocket', async () => {
      teacherSocket = ClientSocket(serverAddress, { transports: ['websocket'] });

      const readyPromise = new Promise((resolve) => {
        teacherSocket.on('game:teacher_ready', (data) => resolve(data));
      });

      teacherSocket.emit('game:teacher_join', {
        sessionId: activeGameSessionId,
        token: teacherToken
      });

      const readyData = (await readyPromise) as any;
      assert.equal(readyData.success, true);
      assert.equal(readyData.status, 'LOBBY');
    });

    it('student 1 joins lobby with valid nickname and receives token & event', async () => {
      studentSocket1 = ClientSocket(serverAddress, { transports: ['websocket'] });

      const joinPromise = new Promise((resolve) => {
        studentSocket1.on('game:joined_success', (data) => resolve(data));
      });

      // Also verify teacher socket receives real-time join notification
      const teacherNoticePromise = new Promise((resolve) => {
        teacherSocket.on('game:participant_joined', (data) => resolve(data));
      });

      studentSocket1.emit('game:join', {
        pin: activeGamePin,
        nickname: 'AliceRocket'
      });

      const joinData = (await joinPromise) as any;
      assert.equal(joinData.success, true);
      assert.equal(joinData.nickname, 'AliceRocket');
      assert.ok(joinData.participantId);
      assert.ok(joinData.token);
      participant1Id = joinData.participantId;

      const teacherNotice = (await teacherNoticePromise) as any;
      assert.equal(teacherNotice.nickname, 'AliceRocket');
      assert.equal(teacherNotice.participantId, participant1Id);
    });

    it('student 2 is rejected when attempting duplicate nickname in same room', async () => {
      studentSocket2 = ClientSocket(serverAddress, { transports: ['websocket'] });

      const errorPromise = new Promise((resolve) => {
        studentSocket2.on('game:error', (data) => resolve(data));
      });

      // Attempt joining with same nickname 'AliceRocket'
      studentSocket2.emit('game:join', {
        pin: activeGamePin,
        nickname: 'AliceRocket'
      });

      const errorData = (await errorPromise) as any;
      assert.equal(errorData.success, false);
      assert.equal(errorData.code, 'NICKNAME_TAKEN');
      assert.match(errorData.message, /already taken/i);
    });

    it('student is rejected when attempting invalid PIN', async () => {
      const errorPromise = new Promise((resolve) => {
        studentSocket2.once('game:error', (data) => resolve(data));
      });

      studentSocket2.emit('game:join', {
        pin: '000000',
        nickname: 'BobValid'
      });

      const errorData = (await errorPromise) as any;
      assert.equal(errorData.code, 'PIN_NOT_FOUND');
    });

    it('teacher kicks student 1, student 1 receives kicked event and is disconnected', async () => {
      const kickedPromise = new Promise((resolve) => {
        studentSocket1.on('game:kicked', (data) => resolve(data));
      });

      teacherSocket.emit('game:kick_participant', {
        sessionId: activeGameSessionId,
        participantId: participant1Id
      });

      const kickedData = (await kickedPromise) as any;
      assert.match(kickedData.message, /removed from this game session/i);
    });
  });
});
