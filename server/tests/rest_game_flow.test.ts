import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildApp, AppInstance } from '../src/app.js';
import { DatabaseService } from '../src/db/database.js';
import { securityConfig, UserRole } from '../src/config/security.js';
import { signAuthToken } from '../src/auth/crypto.js';

describe('Phase 8: REST Game Flow & Realtime Fallback Suite', () => {
  let app: AppInstance;
  let db: DatabaseService;

  let teacherToken: string;
  let otherTeacherToken: string;
  let quizId: string;
  let gameSessionId: string;
  let gamePin: string;

  let question1Id: string;
  let question2Id: string;
  let correctOption1Id: string;
  let wrongOption1Id: string;
  let correctOption2Id: string;

  let studentAToken: string;
  let studentAId: string;
  let studentBToken: string;

  const json = (res: any) => JSON.parse(res.body);
  const stateOf = async (sessionId = gameSessionId) => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/games/${sessionId}/state` });
    assert.equal(res.statusCode, 200);
    return json(res).state;
  };

  before(async () => {
    db = new DatabaseService(':memory:');
    app = buildApp(db, { enableRealtime: false });
    await app.ready();

    // Teacher 1 (host)
    const resT1 = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'rest_host@school.edu',
        password: 'Password12345',
        displayName: 'RestHost',
        requestedRole: UserRole.TEACHER,
        invitationCode: securityConfig.teacherRegistrationSecret
      }
    });
    teacherToken = json(resT1).token;

    // Teacher 2 (intruder)
    const resT2 = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'rest_intruder@school.edu',
        password: 'Password12345',
        displayName: 'RestIntruder',
        requestedRole: UserRole.TEACHER,
        invitationCode: securityConfig.teacherRegistrationSecret
      }
    });
    otherTeacherToken = json(resT2).token;

    // Quiz with 2 questions
    const resQ = await app.inject({
      method: 'POST',
      url: '/api/v1/quizzes',
      headers: { authorization: `Bearer ${teacherToken}` },
      payload: { title: 'REST Flow Quiz', description: 'Realtime fallback tests' }
    });
    quizId = json(resQ).quiz.id;

    const resQ1 = await app.inject({
      method: 'POST',
      url: `/api/v1/quizzes/${quizId}/questions`,
      headers: { authorization: `Bearer ${teacherToken}` },
      payload: {
        prompt: 'What is 2 + 2?',
        timeLimitSec: 60,
        basePoints: 1000,
        options: [
          { optionText: '3', isCorrect: false },
          { optionText: '4', isCorrect: true }
        ]
      }
    });
    question1Id = json(resQ1).question.id;
    correctOption1Id = db.getSecretAnswerKey(question1Id)!.correctOptionId;
    wrongOption1Id = db.getPublicQuestionForStudent(question1Id)!.options.find(o => o.id !== correctOption1Id)!.id;

    const resQ2 = await app.inject({
      method: 'POST',
      url: `/api/v1/quizzes/${quizId}/questions`,
      headers: { authorization: `Bearer ${teacherToken}` },
      payload: {
        prompt: 'Capital of France?',
        timeLimitSec: 60,
        basePoints: 1000,
        options: [
          { optionText: 'Berlin', isCorrect: false },
          { optionText: 'Paris', isCorrect: true }
        ]
      }
    });
    question2Id = json(resQ2).question.id;
    correctOption2Id = db.getSecretAnswerKey(question2Id)!.correctOptionId;

    // Host game session
    const resHost = await app.inject({
      method: 'POST',
      url: '/api/v1/games',
      headers: { authorization: `Bearer ${teacherToken}` },
      payload: { quizId }
    });
    const session = json(resHost).session;
    gameSessionId = session.id;
    gamePin = session.pin;
  });

  after(async () => {
    await app.close();
    db.close();
  });

  describe('Join via REST', () => {
    it('joins student A successfully and returns a participant JWT', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/games/join',
        payload: { pin: gamePin, nickname: 'Betina' }
      });

      assert.equal(res.statusCode, 201);
      const body = json(res);
      studentAId = body.participantId;
      studentAToken = body.token;
      assert.equal(body.sessionId, gameSessionId);
      assert.ok(body.token);
      assert.equal(body.quizTitle, 'REST Flow Quiz');
    });

    it('rejects a duplicate nickname with 409', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/games/join',
        payload: { pin: gamePin, nickname: 'Betina' }
      });
      assert.equal(res.statusCode, 409);
    });

    it('joins student B successfully', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/games/join',
        payload: { pin: gamePin, nickname: 'Anna' }
      });
      assert.equal(res.statusCode, 201);
      studentBToken = json(res).token;
    });

    it('rejects an unknown PIN with 404', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/games/join',
        payload: { pin: '000000', nickname: 'Ghost' }
      });
      assert.equal(res.statusCode, 404);
    });

    it('exposes sanitized LOBBY state to the public', async () => {
      const state = await stateOf();
      assert.equal(state.status, 'LOBBY');
      assert.equal(state.quizTitle, 'REST Flow Quiz');
      assert.equal(state.totalQuestions, 2);
      assert.equal(state.totalParticipants, 2);
      assert.ok(!('prompt' in state) || state.prompt == null);
      assert.ok(!('revealedCorrectOptionId' in state) || state.revealedCorrectOptionId == null);
      assert.ok(!('options' in state) || !state.options || state.options.length === 0);
    });
  });

  describe('Authorization Matrix', () => {
    it('rejects /start without authentication (401)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/games/${gameSessionId}/start`
      });
      assert.equal(res.statusCode, 401);
    });

    it('rejects /answers without a participant token (401)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/games/answers',
        payload: { sessionId: gameSessionId, questionId: question1Id, selectedOptionId: correctOption1Id, roundNonce: 'whatever' }
      });
      assert.equal(res.statusCode, 401);
    });

    it('rejects student start attempt (403)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/games/${gameSessionId}/start`,
        headers: { authorization: `Bearer ${studentAToken}` }
      });
      assert.equal(res.statusCode, 403);
    });

    it('rejects non-host teacher start attempt (403)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/games/${gameSessionId}/start`,
        headers: { authorization: `Bearer ${otherTeacherToken}` }
      });
      assert.equal(res.statusCode, 403);
    });

    it('rejects participant calling teacher-only leaderboard POST (403)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/games/${gameSessionId}/leaderboard`,
        headers: { authorization: `Bearer ${studentAToken}` }
      });
      assert.equal(res.statusCode, 403);
    });
  });

  describe('Question 1: dispatch, answers, reveal', () => {
    it('starts the game and publishes a sanitized QUESTION_ACTIVE state', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/games/${gameSessionId}/start`,
        headers: { authorization: `Bearer ${teacherToken}` }
      });
      assert.equal(res.statusCode, 200);
      assert.equal(json(res).success, true);

      const state = await stateOf();
      assert.equal(state.status, 'QUESTION_ACTIVE');
      assert.equal(state.currentQuestionIndex, 0);
      assert.equal(state.currentQuestionId, question1Id);
      assert.equal(state.totalQuestions, 2);
      assert.equal(state.totalParticipants, 2);
      assert.equal(state.answersCount, 0);
      assert.ok(state.roundNonce && state.roundNonce.length >= 10);
      assert.ok(state.serverDeadline > state.serverStartTime);
      assert.ok(state.options.length === 2);
      for (const opt of state.options) {
        assert.ok(!('is_correct' in opt));
        assert.ok(!('isCorrect' in opt));
      }
      assert.equal(state.revealedCorrectOptionId, null);
    });

    it('rejects joining the lobby once the game has started (400)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/games/join',
        payload: { pin: gamePin, nickname: 'Latecomer' }
      });
      assert.equal(res.statusCode, 400);
    });

    it('rejects a teacher attempt to finish the round before the deadline (409)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/games/${gameSessionId}/finish-round`,
        headers: { authorization: `Bearer ${teacherToken}` }
      });
      assert.equal(res.statusCode, 409);
      assert.match(json(res).message, /still in progress/i);
    });

    it('accepts student A correct answer with authoritative scoring', async () => {
      const state = await stateOf();
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/games/answers',
        headers: { authorization: `Bearer ${studentAToken}` },
        payload: {
          sessionId: gameSessionId,
          questionId: question1Id,
          selectedOptionId: correctOption1Id,
          roundNonce: state.roundNonce
        }
      });

      assert.equal(res.statusCode, 200);
      const body = json(res);
      assert.equal(body.success, true);
      assert.equal(body.isCorrect, true);
      assert.ok(body.pointsAwarded > 0);
      assert.ok(body.totalScore >= body.pointsAwarded);
      assert.equal(body.streakCount, 1);
    });

    it('rejects answer replay by the same participant (409 DUPLICATE_ANSWER)', async () => {
      const state = await stateOf();
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/games/answers',
        headers: { authorization: `Bearer ${studentAToken}` },
        payload: {
          sessionId: gameSessionId,
          questionId: question1Id,
          selectedOptionId: correctOption1Id,
          roundNonce: state.roundNonce
        }
      });
      assert.equal(res.statusCode, 409);
      assert.equal(json(res).code, 'DUPLICATE_ANSWER');
    });

    it('rejects an answer with a forged/wrong round nonce (409 INVALID_NONCE)', async () => {
      const forgedNonce = crypto.randomBytes(16).toString('hex');
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/games/answers',
        headers: { authorization: `Bearer ${studentBToken}` },
        payload: {
          sessionId: gameSessionId,
          questionId: question1Id,
          selectedOptionId: correctOption1Id,
          roundNonce: forgedNonce
        }
      });
      assert.equal(res.statusCode, 409);
      assert.equal(json(res).code, 'INVALID_NONCE');
    });

    it('rejects an answer from a participant of another (fake) session (409 PARTICIPANT_NOT_ACTIVE)', async () => {
      const foreignId = crypto.randomUUID();
      const foreignToken = signAuthToken({ userId: foreignId, email: '', role: UserRole.STUDENT, displayName: 'Ghost' });
      const state = await stateOf();
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/games/answers',
        headers: { authorization: `Bearer ${foreignToken}` },
        payload: {
          sessionId: gameSessionId,
          questionId: question1Id,
          selectedOptionId: correctOption1Id,
          roundNonce: state.roundNonce
        }
      });
      assert.equal(res.statusCode, 409);
      assert.equal(json(res).code, 'PARTICIPANT_NOT_ACTIVE');
    });

    it('closes round early when all participants have answered', async () => {
      const state = await stateOf();
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/games/answers',
        headers: { authorization: `Bearer ${studentBToken}` },
        payload: {
          sessionId: gameSessionId,
          questionId: question1Id,
          selectedOptionId: correctOption1Id,
          roundNonce: state.roundNonce
        }
      });
      assert.equal(res.statusCode, 200);

      const after = await stateOf();
      assert.equal(after.status, 'QUESTION_RESULTS');
      assert.equal(after.answersCount, 2);
    });

    it('reveals the correct option only after QUESTION_RESULTS', async () => {
      const state = await stateOf();
      assert.equal(state.revealedCorrectOptionId, correctOption1Id);
      assert.equal(state.roundNonce, state.roundNonce);
    });
  });

  describe('Leaderboard & Next Question', () => {
    it('shows leaderboard for teacher, participants, but not outsiders', async () => {
      const resT = await app.inject({
        method: 'POST',
        url: `/api/v1/games/${gameSessionId}/leaderboard`,
        headers: { authorization: `Bearer ${teacherToken}` }
      });
      assert.equal(resT.statusCode, 200);

      const state = await stateOf();
      assert.equal(state.status, 'LEADERBOARD');
      assert.ok(state.leaderboard && state.leaderboard.length === 2);
      for (const entry of state.leaderboard!) {
        assert.equal(typeof entry.nickname, 'string');
        assert.equal(typeof entry.score, 'number');
        assert.ok(!('id' in entry));
        assert.ok(!('user_id' in entry));
      }

      const resStudent = await app.inject({
        method: 'GET',
        url: `/api/v1/games/${gameSessionId}/leaderboard`,
        headers: { authorization: `Bearer ${studentAToken}` }
      });
      assert.equal(resStudent.statusCode, 200);
      assert.ok(json(resStudent).leaderboard.length === 2);

      const foreignId = crypto.randomUUID();
      const foreignToken = signAuthToken({ userId: foreignId, email: '', role: UserRole.STUDENT, displayName: 'Ghost' });
      const resForeign = await app.inject({
        method: 'GET',
        url: `/api/v1/games/${gameSessionId}/leaderboard`,
        headers: { authorization: `Bearer ${foreignToken}` }
      });
      assert.equal(resForeign.statusCode, 403);
    });

    it('dispatches question 2 via next', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/games/${gameSessionId}/next`,
        headers: { authorization: `Bearer ${teacherToken}` }
      });
      assert.equal(res.statusCode, 200);
      assert.equal(json(res).success, true);
      assert.equal(json(res).questionIndex, 1);

      const state = await stateOf();
      assert.equal(state.status, 'QUESTION_ACTIVE');
      assert.equal(state.currentQuestionId, question2Id);
      assert.equal(state.currentQuestionIndex, 1);
      assert.equal(state.revealedCorrectOptionId, null);
      for (const opt of state.options) {
        assert.ok(!('is_correct' in opt));
        assert.ok(!('isCorrect' in opt));
      }
    });

    it('does not reveal question 2 answer while active (leakage check)', async () => {
      const state = await stateOf();
      const raw = JSON.stringify(state);
      assert.ok(!raw.includes('isCorrect'));
      assert.ok(!raw.includes('is_correct'));
      assert.equal(state.revealedCorrectOptionId, null);
    });
  });

  describe('Expired question closes via server deadline', () => {
    it('rejects a late answer as DEADLINE_EXCEEDED and closes the round', async () => {
      db.updateSessionState(gameSessionId, {
        question_deadline: Date.now() - 5000,
        question_start_time: Date.now() - 70000
      });

      const state = await stateOf();
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/games/answers',
        headers: { authorization: `Bearer ${studentAToken}` },
        payload: {
          sessionId: gameSessionId,
          questionId: question2Id,
          selectedOptionId: correctOption2Id,
          roundNonce: state.roundNonce
        }
      });
      assert.equal(res.statusCode, 409);
      assert.equal(json(res).code, 'DEADLINE_EXCEEDED');

      const after = await stateOf();
      assert.equal(after.status, 'QUESTION_RESULTS');
      assert.equal(after.revealedCorrectOptionId, correctOption2Id);
    });

    it('accepts idempotent finish-round after the round already closed', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/games/${gameSessionId}/finish-round`,
        headers: { authorization: `Bearer ${teacherToken}` }
      });
      assert.equal(res.statusCode, 200);
      assert.equal(json(res).success, true);
      assert.equal(json(res).correctOptionId, correctOption2Id);
    });
  });

  describe('Final Podium', () => {
    it('finishes the game with podium after the last question', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/games/${gameSessionId}/next`,
        headers: { authorization: `Bearer ${teacherToken}` }
      });
      assert.equal(res.statusCode, 200);
      assert.equal(json(res).finished, true);
      assert.ok(json(res).podium.topThree.length >= 1);
      assert.equal(json(res).podium.totalParticipants, 2);

      const state = await stateOf();
      assert.equal(state.status, 'FINISHED');
      assert.ok(state.podium && state.podium.topThree.length >= 1);
      assert.equal(state.podium.totalParticipants, 2);
    });

    it('returns personal result for a participating student', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/games/${gameSessionId}/podium`,
        headers: { authorization: `Bearer ${studentAToken}` }
      });
      assert.equal(res.statusCode, 200);
      const body = json(res);
      assert.ok(body.podium);
      assert.ok(body.personalResult);
      assert.equal(typeof body.personalResult.rank, 'number');
      assert.equal(typeof body.personalResult.totalScore, 'number');
    });

    it('rejects podium access for a non-member student token (403)', async () => {
      const foreignId = crypto.randomUUID();
      const foreignToken = signAuthToken({ userId: foreignId, email: '', role: UserRole.STUDENT, displayName: 'Ghost' });
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/games/${gameSessionId}/podium`,
        headers: { authorization: `Bearer ${foreignToken}` }
      });
      assert.equal(res.statusCode, 403);
    });
  });

  describe('Kick via REST', () => {
    it('kicks a participant and blocks their subsequent answers', async () => {
      const resHost = await app.inject({
        method: 'POST',
        url: '/api/v1/games',
        headers: { authorization: `Bearer ${teacherToken}` },
        payload: { quizId }
      });
      const kickSessionId = json(resHost).session.id;
      const kickPin = json(resHost).session.pin;

      const resJoin = await app.inject({
        method: 'POST',
        url: '/api/v1/games/join',
        payload: { pin: kickPin, nickname: 'CookieBoi' }
      });
      assert.equal(resJoin.statusCode, 201);
      const kickedId = json(resJoin).participantId;
      const kickedToken = json(resJoin).token;

      const resKick = await app.inject({
        method: 'POST',
        url: `/api/v1/games/${kickSessionId}/kick`,
        headers: { authorization: `Bearer ${teacherToken}` },
        payload: { sessionId: kickSessionId, participantId: kickedId }
      });
      assert.equal(resKick.statusCode, 200);

      await app.inject({
        method: 'POST',
        url: `/api/v1/games/${kickSessionId}/start`,
        headers: { authorization: `Bearer ${teacherToken}` }
      });

      const state = await stateOf(kickSessionId);
      assert.equal(state.status, 'QUESTION_ACTIVE');

      const resAnswer = await app.inject({
        method: 'POST',
        url: '/api/v1/games/answers',
        headers: { authorization: `Bearer ${kickedToken}` },
        payload: {
          sessionId: kickSessionId,
          questionId: state.currentQuestionId,
          selectedOptionId: correctOption1Id,
          roundNonce: state.roundNonce
        }
      });
      assert.equal(resAnswer.statusCode, 409);
      assert.equal(json(resAnswer).code, 'PARTICIPANT_NOT_ACTIVE');
    });

    it('rejects a kick with mismatched sessionId (400)', async () => {
      const resHost = await app.inject({
        method: 'POST',
        url: '/api/v1/games',
        headers: { authorization: `Bearer ${teacherToken}` },
        payload: { quizId }
      });
      const sessionId = json(resHost).session.id;

      const resKick = await app.inject({
        method: 'POST',
        url: `/api/v1/games/${sessionId}/kick`,
        headers: { authorization: `Bearer ${teacherToken}` },
        payload: { sessionId: gameSessionId, participantId: crypto.randomUUID() }
      });
      assert.equal(resKick.statusCode, 400);
    });
  });
});