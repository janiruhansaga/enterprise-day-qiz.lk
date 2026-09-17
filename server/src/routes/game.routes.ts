import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import crypto from 'node:crypto';
import { CreateGameSessionSchema } from '../game/schemas.js';
import { generateSecureGamePin } from '../game/pinGenerator.js';
import { IDatastore } from '../db/datastore.interface.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { UserRole } from '../config/security.js';
import { pinLookupRateLimiter } from '../middleware/rateLimiter.js';

export function createGameRoutes(db: IDatastore): FastifyPluginAsync {
  return async (fastify: FastifyInstance) => {

    // POST /api/v1/games - Host starts a new game session (Lobby)
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

    // GET /api/v1/games/:id - Teacher gets active game session details
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

    // GET /api/v1/games/pin/:pin - Public endpoint for student join validation (Rate Limited)
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

      // Data minimization: Return only sanitized info needed to render join confirmation
      return reply.send({
        valid: true,
        sessionId: session.id,
        status: session.status,
        quizTitle: quiz?.title || 'Live Quiz'
      });
    });
  };
}
