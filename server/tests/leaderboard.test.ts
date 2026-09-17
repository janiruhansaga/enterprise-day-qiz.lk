import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { io as ClientSocket, Socket as ClientSocketType } from 'socket.io-client';
import { buildApp, AppInstance } from '../src/app.js';
import { DatabaseService } from '../src/db/database.js';
import { securityConfig, UserRole } from '../src/config/security.js';

describe('Phase 8: Real-Time Leaderboard & Privacy Defense Suite', () => {
  let app: AppInstance;
  let db: DatabaseService;
  let serverAddress: string;

  let teacherToken: string;
  let quizId: string;
  let gamePin: string;
  let gameSessionId: string;
  let teacherSocket: ClientSocketType;
  let student1Socket: ClientSocketType;
  let student2Socket: ClientSocketType;
  let student3Socket: ClientSocketType;

  let student1Id: string;
  let student2Id: string;
  let student3Id: string;

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
        email: 'prof_leaderboard@school.edu',
        password: 'Password12345',
        displayName: 'ProfLeaderboard',
        requestedRole: UserRole.TEACHER,
        invitationCode: securityConfig.teacherRegistrationSecret
      }
    });
    teacherToken = JSON.parse(resT.body).token;

    // Create Quiz with 1 question
    const resQ = await app.inject({
      method: 'POST',
      url: '/api/v1/quizzes',
      headers: { authorization: `Bearer ${teacherToken}` },
      payload: { title: 'Leaderboard Exam', description: 'Testing rank math' }
    });
    quizId = JSON.parse(resQ.body).quiz.id;

    await app.inject({
      method: 'POST',
      url: `/api/v1/quizzes/${quizId}/questions`,
      headers: { authorization: `Bearer ${teacherToken}` },
      payload: {
        prompt: 'Which protocol is secure?',
        timeLimitSec: 20,
        options: [
          { optionText: 'HTTP', isCorrect: false },
          { optionText: 'HTTPS', isCorrect: true }
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
    const gJson = JSON.parse(resG.body);
    gamePin = gJson.session.pin;
    gameSessionId = gJson.session.id;

    // Connect Teacher
    teacherSocket = ClientSocket(serverAddress, { transports: ['websocket'] });
    await new Promise((resolve) => {
      teacherSocket.on('game:teacher_ready', resolve);
      teacherSocket.emit('game:teacher_join', { sessionId: gameSessionId, token: teacherToken });
    });

    // Connect Student 1 (Winner)
    student1Socket = ClientSocket(serverAddress, { transports: ['websocket'] });
    const j1 = await new Promise<any>((resolve) => {
      student1Socket.on('game:joined_success', resolve);
      student1Socket.emit('game:join', { pin: gamePin, nickname: 'ChampionAlice' });
    });
    student1Id = j1.participantId;

    // Connect Student 2 (Runner up)
    student2Socket = ClientSocket(serverAddress, { transports: ['websocket'] });
    const j2 = await new Promise<any>((resolve) => {
      student2Socket.on('game:joined_success', resolve);
      student2Socket.emit('game:join', { pin: gamePin, nickname: 'SecondBob' });
    });
    student2Id = j2.participantId;

    // Connect Student 3 (Third)
    student3Socket = ClientSocket(serverAddress, { transports: ['websocket'] });
    const j3 = await new Promise<any>((resolve) => {
      student3Socket.on('game:joined_success', resolve);
      student3Socket.emit('game:join', { pin: gamePin, nickname: 'ThirdCharlie' });
    });
    student3Id = j3.participantId;

    // Set mock scores in database directly to simulate round completion
    const updateScore = (id: string, score: number, streak: number) => {
      (db as any).db.prepare('UPDATE participants SET total_score = ?, streak_count = ? WHERE id = ?').run(score, streak, id);
    };

    updateScore(student1Id, 2500, 3);
    updateScore(student2Id, 1800, 2);
    updateScore(student3Id, 900, 1);
  });

  after(async () => {
    app.gameSocketManager?.getGameEngine().clearSessionTimer(gameSessionId);
    if (student1Socket?.connected) student1Socket.disconnect();
    if (student2Socket?.connected) student2Socket.disconnect();
    if (student3Socket?.connected) student3Socket.disconnect();
    if (teacherSocket?.connected) teacherSocket.disconnect();
    await app.close();
    db.close();
  });

  describe('RBAC Guards on Leaderboard Triggers', () => {
    it('blocks student attempting to emit game:show_leaderboard (FORBIDDEN)', async () => {
      const errPromise = new Promise<any>((resolve) => {
        student1Socket.once('game:error', resolve);
      });

      student1Socket.emit('game:show_leaderboard', { sessionId: gameSessionId });
      const err = await errPromise;
      assert.equal(err.code, 'FORBIDDEN');
    });
  });

  describe('Server-Authoritative Ranking & Privacy Verification', () => {
    let leaderboardData: any;

    it('teacher triggers leaderboard, all connected sockets receive sanitized ranking', async () => {
      const lbPromise = new Promise<any>((resolve) => {
        student1Socket.on('game:leaderboard_update', resolve);
      });

      teacherSocket.emit('game:show_leaderboard', { sessionId: gameSessionId });
      leaderboardData = await lbPromise;

      assert.ok(leaderboardData);
      assert.ok(Array.isArray(leaderboardData.leaderboard));
      assert.equal(leaderboardData.leaderboard.length, 3);

      // Verify Rank 1
      assert.equal(leaderboardData.leaderboard[0].rank, 1);
      assert.equal(leaderboardData.leaderboard[0].nickname, 'ChampionAlice');
      assert.equal(leaderboardData.leaderboard[0].score, 2500);
      assert.equal(leaderboardData.leaderboard[0].streak, 3);

      // Verify Rank 2
      assert.equal(leaderboardData.leaderboard[1].rank, 2);
      assert.equal(leaderboardData.leaderboard[1].nickname, 'SecondBob');
      assert.equal(leaderboardData.leaderboard[1].score, 1800);

      // Verify Rank 3
      assert.equal(leaderboardData.leaderboard[2].rank, 3);
      assert.equal(leaderboardData.leaderboard[2].nickname, 'ThirdCharlie');
      assert.equal(leaderboardData.leaderboard[2].score, 900);
    });

    it('FERPA PRIVACY CHECK: ensures zero PII (email, user ID, internal keys) is emitted', () => {
      for (const entry of leaderboardData.leaderboard) {
        assert.equal((entry as any).id, undefined, 'CRITICAL PRIVACY LEAK: id in leaderboard!');
        assert.equal((entry as any).email, undefined, 'CRITICAL PRIVACY LEAK: email in leaderboard!');
        assert.equal((entry as any).userId, undefined, 'CRITICAL PRIVACY LEAK: userId in leaderboard!');
        assert.equal((entry as any).password_hash, undefined);
      }
    });
  });

  describe('Final Podium & Private Student Results', () => {
    it('broadcasts Top 3 Podium and individual private result to each student', async () => {
      const podiumPromise = new Promise<any>((resolve) => {
        student2Socket.on('game:final_podium', resolve);
      });

      const personalResultPromise2 = new Promise<any>((resolve) => {
        student2Socket.on('game:final_personal_result', resolve);
      });

      const personalResultPromise3 = new Promise<any>((resolve) => {
        student3Socket.on('game:final_personal_result', resolve);
      });

      // Teacher advances past last question to trigger quiz finish
      // Set session question index to last question (0)
      db.updateSessionState(gameSessionId, { current_question_index: 0 });
      teacherSocket.emit('game:next_question', { sessionId: gameSessionId });

      const podiumData = await podiumPromise;
      assert.ok(podiumData);
      assert.equal(podiumData.totalParticipants, 3);
      assert.equal(podiumData.topThree[0].nickname, 'ChampionAlice');
      assert.equal(podiumData.topThree[1].nickname, 'SecondBob');
      assert.equal(podiumData.topThree[2].nickname, 'ThirdCharlie');

      // Check student 2's private personal result
      const p2Result = await personalResultPromise2;
      assert.equal(p2Result.rank, 2);
      assert.equal(p2Result.totalScore, 1800);

      // Check student 3's private personal result
      const p3Result = await personalResultPromise3;
      assert.equal(p3Result.rank, 3);
      assert.equal(p3Result.totalScore, 900);
    });
  });
});
