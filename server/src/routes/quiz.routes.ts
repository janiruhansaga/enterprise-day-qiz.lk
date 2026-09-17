import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import crypto from 'node:crypto';
import { CreateQuizSchema, UpdateQuizSchema, CreateQuestionSchema } from '../quiz/schemas.js';
import { IDatastore } from '../db/datastore.interface.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { UserRole } from '../config/security.js';

export function createQuizRoutes(db: IDatastore): FastifyPluginAsync {
  return async (fastify: FastifyInstance) => {
    // Enforce teacher or admin role on ALL quiz routes
    fastify.addHook('preHandler', authenticate);
    fastify.addHook('preHandler', requireRole(UserRole.TEACHER, UserRole.ADMIN));

    // GET /api/v1/quizzes - List quizzes owned by current teacher
    fastify.get('/', async (request, reply) => {
      const teacherId = request.user!.userId;
      const quizzes = await db.getQuizzesByTeacher(teacherId);
      return reply.send({
        quizzes: quizzes.map(q => ({
          ...q,
          is_published: Boolean(q.is_published)
        }))
      });
    });

    // POST /api/v1/quizzes - Create new quiz
    fastify.post('/', async (request, reply) => {
      const parseResult = CreateQuizSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Validation failed',
          errors: parseResult.error.flatten().fieldErrors
        });
      }

      const teacherId = request.user!.userId;
      const quizId = crypto.randomUUID();
      const now = Date.now();

      await db.createQuiz({
        id: quizId,
        teacher_id: teacherId,
        title: parseResult.data.title,
        description: parseResult.data.description || '',
        is_published: parseResult.data.isPublished || false,
        created_at: now,
        updated_at: now
      });

      return reply.status(201).send({
        statusCode: 201,
        message: 'Quiz created successfully',
        quiz: {
          id: quizId,
          teacherId,
          title: parseResult.data.title,
          description: parseResult.data.description,
          isPublished: parseResult.data.isPublished || false,
          createdAt: now
        }
      });
    });

    // GET /api/v1/quizzes/:id - Get quiz details with questions & answer keys (Ownership Enforced)
    fastify.get('/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      const teacherId = request.user!.userId;

      // IDOR / BOLA Prevention: Verify ownership
      const quiz = await db.getQuizWithDetailsForTeacher(id, teacherId);
      if (!quiz) {
        // Return 404 to avoid leaking whether another teacher's quiz exists
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Quiz not found or you do not have permission to access it'
        });
      }

      return reply.send({ quiz });
    });

    // PUT /api/v1/quizzes/:id - Update quiz metadata (Ownership Enforced)
    fastify.put('/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      const teacherId = request.user!.userId;

      const parseResult = UpdateQuizSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Validation failed',
          errors: parseResult.error.flatten().fieldErrors
        });
      }

      const updated = await db.updateQuiz(id, teacherId, {
        title: parseResult.data.title,
        description: parseResult.data.description,
        is_published: parseResult.data.isPublished
      });

      if (!updated) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Quiz not found or you do not have permission to modify it'
        });
      }

      return reply.send({
        statusCode: 200,
        message: 'Quiz updated successfully'
      });
    });

    // DELETE /api/v1/quizzes/:id - Delete quiz (Ownership Enforced)
    fastify.delete('/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      const teacherId = request.user!.userId;

      const deleted = await db.deleteQuiz(id, teacherId);
      if (!deleted) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Quiz not found or you do not have permission to delete it'
        });
      }

      return reply.send({
        statusCode: 200,
        message: 'Quiz deleted successfully'
      });
    });

    // POST /api/v1/quizzes/:id/questions - Add question with options & secret answer key
    fastify.post('/:id/questions', async (request, reply) => {
      const { id } = request.params as { id: string };
      const teacherId = request.user!.userId;

      // Verify ownership before adding question
      const existing = await db.getQuizById(id);
      if (!existing || existing.teacher_id !== teacherId) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Quiz not found or you do not have permission to modify it'
        });
      }

      const parseResult = CreateQuestionSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Validation failed',
          errors: parseResult.error.flatten().fieldErrors
        });
      }

      const questionId = crypto.randomUUID();
      const orderIndex = await db.getNextQuestionOrder(id);
      const now = Date.now();

      const options = parseResult.data.options.map((opt, idx) => ({
        id: crypto.randomUUID(),
        option_text: opt.optionText,
        order_index: idx,
        is_correct: opt.isCorrect
      }));

      await db.addQuestionWithSecretAnswers(
        {
          id: questionId,
          quiz_id: id,
          order_index: orderIndex,
          prompt: parseResult.data.prompt,
          time_limit_sec: parseResult.data.timeLimitSec || 20,
          base_points: parseResult.data.basePoints || 1000,
          created_at: now
        },
        options
      );

      return reply.status(201).send({
        statusCode: 201,
        message: 'Question added successfully',
        question: {
          id: questionId,
          quizId: id,
          orderIndex,
          prompt: parseResult.data.prompt,
          timeLimitSec: parseResult.data.timeLimitSec || 20,
          basePoints: parseResult.data.basePoints || 1000,
          optionsCount: options.length
        }
      });
    });
  };
}
