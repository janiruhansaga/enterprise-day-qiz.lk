import { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'node:crypto';
import { CreateGameSessionSchema, JoinGameSchema, KickParticipantSchema } from '../game/schemas.js';
import { SubmitAnswerSchema } from '../game/answerSchemas.js';
import { generateSecureGamePin } from '../game/pinGenerator.js';
import { IDatastore } from '../db/datastore.interface.js';
import { authenticate, requireRole, verifyAnyToken } from '../middleware/auth.js';
import { UserRole, securityConfig } from '../config/security.js';
import { pinLookupRateLimiter } from '../middleware/rateLimiter.js';
import { isAppropriateNickname } from '../security/sanitizer.js';
import { signAuthToken } from '../auth/crypto.js';
import { TokenPayload } from '../auth/crypto.js';
import { ScoringEngine } from '../engine/scoringEngine.js';
import { LeaderboardEngine } from '../engine/leaderboardEngine.js';
import {
  buildPublicState,
  publishPublicState,
  dispatchQuestion,
  ensureRoundEnded,
  showLeaderboard,
  finishGame
} from '../engine/restFlow.js';

function getTokenFromRequest(request: FastifyRequest): string | undefined {
  const cookieToken = request.cookies[securityConfig.cookieName];
  if (cookieToken) return cookieToken;
  const authHeader = request.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }
  return undefined;
}

export function createGameRoutes(db: IDatastore): FastifyPluginAsync {
  return async (fastify: FastifyInstance) => {

    // =========================================================================
    // TEACHER-ONLY: Host a new game session (Lobby)
    // =========================================================================
    fastify.post('/', { preHandler: [authenticate, requireRole(UserRole.TEACHER, UserRole.ADMIN)] }, async (request, reply) => {
      const parseResult = CreateGameSessionSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Validation failed',
          errors: parseResult.error.flatten().fieldErrors
        });
      }

      const { quizId } = parseResult.data;
      const teacherId = request.user!.userId;

      // Anti-IDOR: Check quiz exists and is owned by authenticated teacher
      const quiz = await db.getQuizById(quizId);
      if (!quiz || quiz.teacher_id !== teacherId) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Quiz not found or you do not have permission to host it'
        });
      }

      // Check quiz has at least 1 question
      const questions = await db.getQuestionsForQuiz(quizId);
      if (questions.length === 0) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Cannot host a game with 0 questions. Add at least one question first.'
        });
      }

      const sessionId = crypto.randomUUID();
      const pin = await generateSecureGamePin(db);
      const now = Date.now();

      await db.createGameSession({
        id: sessionId,
        pin,
        quiz_id: quizId,
        host_teacher_id: teacherId,
        created_at: now
      });

      const session = await db.findSessionById(sessionId);
      if (session) {
        await publishPublicState(db, session);
      }

      return reply.status(201).send({
        statusCode: 201,
        message: 'Game session created',
        session: {
          id: sessionId,
          pin,
          quizId,
          quizTitle: quiz.title,
          status: 'LOBBY',
          questionCount: questions.length,
          createdAt: now
        }
      });
    });

    // =========================================================================
    // PUBLIC: Join a game as a participant (Rate Limited). Returns participant JWT.
    // =========================================================================
    fastify.post('/join', { preHandler: [pinLookupRateLimiter.middleware('pin_lookup')] }, async (request, reply) => {
      const parseResult = JoinGameSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Validation failed',
          errors: parseResult.error.flatten().fieldErrors
        });
      }

      const { pin, nickname } = parseResult.data;

      const nicknameCheck = isAppropriateNickname(nickname);
      if (!nicknameCheck.valid) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: nicknameCheck.reason || 'Nickname is not appropriate'
        });
      }

      const session = await db.findSessionByPin(pin);
      if (!session) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Game not found. Please verify the PIN and try again.'
        });
      }

      if (session.status !== 'LOBBY') {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Game session is no longer accepting new players.'
        });
      }

      const participantId = crypto.randomUUID();
      try {
        await db.addParticipant({
          id: participantId,
          session_id: session.id,
          nickname,
          joined_at: Date.now()
        });
      } catch (err: any) {
        if (err && err.message && err.message.includes('UNIQUE constraint failed')) {
          return reply.status(409).send({
            statusCode: 409,
            error: 'Conflict',
            message: 'Nickname is already taken in this game. Choose another.'
          });
        }
        throw err;
      }

      const quiz = await db.getQuizById(session.quiz_id);
      const token = signAuthToken({
        userId: participantId,
        email: '',
        role: UserRole.STUDENT,
        displayName: nickname
      });

      await publishPublicState(db, session);

      return reply.status(201).send({
        statusCode: 201,
        message: 'Joined game session',
        participantId,
        sessionId: session.id,
        gamePin: pin,
        quizTitle: quiz?.title || 'Live Quiz',
        status: 'LOBBY',
        token
      });
    });

    // =========================================================================
    // PARTICIPANT-ONLY: Submit an answer
    // =========================================================================
    fastify.post('/answers', { preHandler: [authenticateParticipant] }, async (request, reply) => {
      const parseResult = SubmitAnswerSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Validation failed',
          errors: parseResult.error.flatten().fieldErrors
        });
      }

      const participantId = request.user!.userId;
      const { sessionId, questionId, selectedOptionId, roundNonce } = parseResult.data;

      const scoringEngine = new ScoringEngine(db);
      const result = await scoringEngine.submitAnswer({
        sessionId,
        participantId,
        questionId,
        selectedOptionId,
        roundNonce,
        serverReceivedTime: Date.now()
      });

      if (!result.success) {
        if (result.code === 'DEADLINE_EXCEEDED') {
          const session = await db.findSessionById(sessionId);
          if (session && session.current_question_id === questionId) {
            await ensureRoundEnded(db, sessionId, 'DEADLINE_EXCEEDED');
          }
        }
        return reply.status(409).send({
          statusCode: 409,
          error: 'Conflict',
          message: result.message || 'Answer rejected',
          code: result.code
        });
      }

      // Early round closure when all active participants have answered
      const session = await db.findSessionById(sessionId);
      if (session && session.status === 'QUESTION_ACTIVE' && db.countQuestionResponses) {
        const answersCount = await db.countQuestionResponses(sessionId, session.current_question_id);
        const totalParticipants = await db.getSessionParticipants(sessionId);
        if (totalParticipants.length === 0 || answersCount >= totalParticipants.length) {
          await ensureRoundEnded(db, sessionId, 'ALL_ANSWERED');
        } else {
          await publishPublicState(db, session);
        }
      }

      return reply.send({
        success: true,
        isCorrect: result.isCorrect,
        pointsAwarded: result.pointsAwarded,
        totalScore: result.totalScore,
        streakCount: result.streakCount,
        responseTimeMs: result.responseTimeMs
      });
    });

    // =========================================================================
    // TEACHER-ONLY: Host actions
    // =========================================================================
    fastify.post('/:id/start', { preHandler: [authenticate, requireRole(UserRole.TEACHER, UserRole.ADMIN)] }, async (request, reply) => {
      const { id } = request.params as { id: string };
      const session = await assertHost(db, request.user!, id, reply);
      if (!session) return reply;

      if (session.status !== 'LOBBY') {
        return reply.status(409).send({
          statusCode: 409,
          error: 'Conflict',
          message: `Cannot start a game that is ${session.status.toLowerCase()}`
        });
      }

      const result = await dispatchQuestion(db, id, 0);
      if (!result.success) {
        return reply.status(500).send({
          statusCode: 500,
          error: 'Internal Server Error',
          message: result.message || 'Could not dispatch question'
        });
      }

      return reply.send({ success: true, questionIndex: 0 });
    });

    fastify.post('/:id/next', { preHandler: [authenticate, requireRole(UserRole.TEACHER, UserRole.ADMIN)] }, async (request, reply) => {
      const { id } = request.params as { id: string };
      const session = await assertHost(db, request.user!, id, reply);
      if (!session) return reply;

      if (session.status !== 'QUESTION_RESULTS' && session.status !== 'LEADERBOARD') {
        return reply.status(409).send({
          statusCode: 409,
          error: 'Conflict',
          message: `Cannot advance from ${session.status.toLowerCase()} state`
        });
      }

      const questions = await db.getQuestionsForQuiz(session.quiz_id);
      const nextIndex = (session.current_question_index ?? -1) + 1;

      if (nextIndex >= questions.length) {
        const podium = await finishGame(db, id);
        return reply.send({
          success: true,
          finished: true,
          podium
        });
      }

      const result = await dispatchQuestion(db, id, nextIndex);
      if (!result.success) {
        return reply.status(500).send({
          statusCode: 500,
          error: 'Internal Server Error',
          message: result.message || 'Could not dispatch question'
        });
      }

      return reply.send({ success: true, questionIndex: nextIndex });
    });

    fastify.post('/:id/finish-round', { preHandler: [authenticate, requireRole(UserRole.TEACHER, UserRole.ADMIN)] }, async (request, reply) => {
      const { id } = request.params as { id: string };
      const session = await assertHost(db, request.user!, id, reply);
      if (!session) return reply;

      if (session.status === 'QUESTION_RESULTS') {
        const answerKey = session.current_question_id
          ? await db.getSecretAnswerKey(session.current_question_id)
          : null;
        return reply.send({
          success: true,
          alreadyFinished: true,
          correctOptionId: answerKey?.correctOptionId || null
        });
      }

      if (session.status !== 'QUESTION_ACTIVE') {
        return reply.status(409).send({
          statusCode: 409,
          error: 'Conflict',
          message: `Cannot finish a round in ${session.status.toLowerCase()} state`
        });
      }

      // Server-authoritative: do not allow early reveal before the real deadline
      if (Date.now() < (session.question_deadline || 0)) {
        return reply.status(409).send({
          statusCode: 409,
          error: 'Conflict',
          message: 'Round still in progress. The question deadline has not elapsed yet.'
        });
      }

      const result = await ensureRoundEnded(db, id, 'TEACHER_FINISHED');
      return reply.send({
        success: true,
        correctOptionId: result.correctOptionId
      });
    });

    fastify.post('/:id/leaderboard', { preHandler: [authenticate, requireRole(UserRole.TEACHER, UserRole.ADMIN)] }, async (request, reply) => {
      const { id } = request.params as { id: string };
      const session = await assertHost(db, request.user!, id, reply);
      if (!session) return reply;

      await showLeaderboard(db, id);
      return reply.send({ success: true });
    });

    fastify.post('/:id/kick', { preHandler: [authenticate, requireRole(UserRole.TEACHER, UserRole.ADMIN)] }, async (request, reply) => {
      const { id } = request.params as { id: string };
      const session = await assertHost(db, request.user!, id, reply);
      if (!session) return reply;

      const parseResult = KickParticipantSchema.safeParse(request.body);
      if (!parseResult.success || parseResult.data.sessionId !== id) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Validation failed'
        });
      }

      const participant = await db.getParticipant(parseResult.data.participantId);
      if (!participant || participant.session_id !== id) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Participant not found in this session'
        });
      }

      await db.removeParticipant(parseResult.data.participantId);
      if (db.markParticipantKicked) {
        await db.markParticipantKicked(id, parseResult.data.participantId);
      }

      const updated = await db.findSessionById(id);
      if (updated) {
        await publishPublicState(db, updated);
      }

      return reply.send({ success: true, participantId: parseResult.data.participantId });
    });

    // =========================================================================
    // HOST OR PARTICIPANT: Read shared results
    // =========================================================================
    fastify.get('/:id/leaderboard', { preHandler: [memberAuth] }, async (request, reply) => {
      const { id } = request.params as { id: string };
      const leaderboardEngine = new LeaderboardEngine(db);
      const leaderboard = await Promise.resolve(leaderboardEngine.getLeaderboard(id, 5));
      return reply.send({ leaderboard });
    });

    fastify.get('/:id/podium', { preHandler: [memberAuth] }, async (request, reply) => {
      const { id } = request.params as { id: string };
      const leaderboardEngine = new LeaderboardEngine(db);
      const { podium, participantRankMap } = await Promise.resolve(leaderboardEngine.getFinalPodium(id));

      let personalResult = null;
      if (request.user && request.user.role === UserRole.STUDENT) {
        const entry = participantRankMap.get(request.user.userId);
        if (entry) {
          personalResult = {
            rank: entry.rank,
            totalScore: entry.totalScore,
            streak: entry.streak
          };
        }
      }

      return reply.send({ podium, personalResult });
    });

    // =========================================================================
    // PUBLIC: Sanitized realtime state document for students
    // =========================================================================
    fastify.get('/:id/state', async (request, reply) => {
      const { id } = request.params as { id: string };
      const session = await db.findSessionById(id);
      if (!session) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Game session not found'
        });
      }

      const state = await buildPublicState(db, session);
      return reply.send({ state });
    });

    // =========================================================================
    // EXISTING: Teacher session details + public PIN lookup
    // =========================================================================
    fastify.get('/:id', { preHandler: [authenticate, requireRole(UserRole.TEACHER, UserRole.ADMIN)] }, async (request, reply) => {
      const { id } = request.params as { id: string };
      const teacherId = request.user!.userId;

      const session = await db.findSessionById(id);
      if (!session || session.host_teacher_id !== teacherId) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Game session not found or you are not authorized'
        });
      }

      const participants = await db.getSessionParticipants(id);
      const quiz = await db.getQuizById(session.quiz_id);

      return reply.send({
        session: {
          ...session,
          quizTitle: quiz?.title || 'Unknown Quiz',
          participants
        }
      });
    });

    fastify.get('/pin/:pin', { preHandler: [pinLookupRateLimiter.middleware('pin_lookup')] }, async (request, reply) => {
      const { pin } = request.params as { pin: string };

      if (!/^\d{6}$/.test(pin)) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Game PIN must be a 6-digit number'
        });
      }

      const session = await db.findSessionByPin(pin);
      if (!session) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Game not found. Please verify the PIN and try again.'
        });
      }

      if (session.status !== 'LOBBY' && session.status !== 'QUESTION_ACTIVE') {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: `Game session is ${session.status.toLowerCase()} and cannot be joined.`
        });
      }

      const quiz = await db.getQuizById(session.quiz_id);

      return reply.send({
        valid: true,
        sessionId: session.id,
        status: session.status,
        quizTitle: quiz?.title || 'Live Quiz'
      });
    });

    // =========================================================================
    // MIDDLEWARE & HELPERS
    // =========================================================================
    async function authenticateParticipant(request: FastifyRequest, reply: FastifyReply) {
      const token = getTokenFromRequest(request);
      if (!token) {
        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Authentication token missing or invalid'
        });
      }

      const payload = await verifyAnyToken(token, db);
      if (!payload) {
        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Invalid or expired session token'
        });
      }

      if (payload.role !== UserRole.STUDENT) {
        return reply.status(403).send({
          statusCode: 403,
          error: 'Forbidden',
          message: 'This endpoint is only accessible to game participants'
        });
      }

      request.user = payload;
    }

    async function memberAuth(request: FastifyRequest, reply: FastifyReply) {
      const token = getTokenFromRequest(request);
      if (!token) {
        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Authentication token missing or invalid'
        });
      }

      const payload = await verifyAnyToken(token, db);
      if (!payload) {
        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Invalid or expired session token'
        });
      }

      const { id } = request.params as { id: string };
      const session = await db.findSessionById(id);
      if (!session) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Game session not found'
        });
      }

      if (payload.role === UserRole.TEACHER || payload.role === UserRole.ADMIN) {
        if (session.host_teacher_id !== payload.userId) {
          return reply.status(403).send({
            statusCode: 403,
            error: 'Forbidden',
            message: 'You are not the host of this game session'
          });
        }
      } else if (payload.role === UserRole.STUDENT) {
        const participant = await db.getParticipant(payload.userId);
        if (!participant || participant.session_id !== id) {
          return reply.status(403).send({
            statusCode: 403,
            error: 'Forbidden',
            message: 'You are not a member of this game session'
          });
        }
      } else {
        return reply.status(403).send({
          statusCode: 403,
          error: 'Forbidden',
          message: 'Access denied'
        });
      }

      request.user = payload;
    }

    async function assertHost(db: IDatastore, user: TokenPayload, sessionId: string, reply: FastifyReply) {
      const session = await db.findSessionById(sessionId);
      if (!session) {
        reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Game session not found'
        });
        return null;
      }
      if (session.host_teacher_id !== user.userId) {
        reply.status(403).send({
          statusCode: 403,
          error: 'Forbidden',
          message: 'You are not the host of this game session'
        });
        return null;
      }
      return session;
    }
  };
}