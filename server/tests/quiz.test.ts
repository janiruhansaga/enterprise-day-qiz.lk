import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { DatabaseService } from '../src/db/database.js';
import { securityConfig, UserRole } from '../src/config/security.js';

describe('Phase 4: Teacher Quiz Management & Anti-IDOR Security Suite', () => {
  let app: ReturnType<typeof buildApp>;
  let db: DatabaseService;

  let teacherAToken: string;
  let teacherBToken: string;
  let studentToken: string;
  let teacherAQuizId: string;

  before(async () => {
    db = new DatabaseService(':memory:');
    app = buildApp(db);
    await app.ready();

    // Register Teacher A
    const resTeacherA = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'teacherA@school.edu',
        password: 'Password12345',
        displayName: 'TeacherAlice',
        requestedRole: UserRole.TEACHER,
        invitationCode: securityConfig.teacherRegistrationSecret
      }
    });
    teacherAToken = JSON.parse(resTeacherA.body).token;

    // Register Teacher B
    const resTeacherB = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'teacherB@school.edu',
        password: 'Password12345',
        displayName: 'TeacherBob',
        requestedRole: UserRole.TEACHER,
        invitationCode: securityConfig.teacherRegistrationSecret
      }
    });
    teacherBToken = JSON.parse(resTeacherB.body).token;

    // Register Student
    const resStudent = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'student@school.edu',
        password: 'Password12345',
        displayName: 'StudentCharlie'
      }
    });
    studentToken = JSON.parse(resStudent.body).token;
  });

  after(async () => {
    await app.close();
    db.close();
  });

  describe('RBAC Guards on Quiz Endpoints', () => {
    it('rejects student attempting to create a quiz (403 Forbidden)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/quizzes',
        headers: { authorization: `Bearer ${studentToken}` },
        payload: {
          title: 'Hacked Quiz by Student',
          description: 'Should be blocked'
        }
      });

      assert.equal(res.statusCode, 403);
    });

    it('rejects unauthenticated request to quiz list (401 Unauthorized)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/quizzes'
      });

      assert.equal(res.statusCode, 401);
    });

    it('allows Teacher A to create a quiz (201 Created)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/quizzes',
        headers: { authorization: `Bearer ${teacherAToken}` },
        payload: {
          title: 'Introduction to Web Security',
          description: 'Quiz on OWASP Top 10 and Cryptography',
          isPublished: true
        }
      });

      assert.equal(res.statusCode, 201);
      const json = JSON.parse(res.body);
      assert.ok(json.quiz.id);
      assert.equal(json.quiz.title, 'Introduction to Web Security');
      teacherAQuizId = json.quiz.id;
    });
  });

  describe('Question Authoring & Correctness Rules', () => {
    it('rejects question with no correct answer marked (Bad Request 400)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/quizzes/${teacherAQuizId}/questions`,
        headers: { authorization: `Bearer ${teacherAToken}` },
        payload: {
          prompt: 'Which protocol secures HTTP communications?',
          timeLimitSec: 20,
          options: [
            { optionText: 'FTP', isCorrect: false },
            { optionText: 'SMTP', isCorrect: false },
            { optionText: 'TELNET', isCorrect: false }
          ]
        }
      });

      assert.equal(res.statusCode, 400);
      const json = JSON.parse(res.body);
      assert.match(JSON.stringify(json.errors), /At least one option must be marked as correct/);
    });

    it('rejects question with fewer than 2 options (Bad Request 400)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/quizzes/${teacherAQuizId}/questions`,
        headers: { authorization: `Bearer ${teacherAToken}` },
        payload: {
          prompt: 'True or False: SQL injection is preventable?',
          timeLimitSec: 20,
          options: [
            { optionText: 'True', isCorrect: true }
          ]
        }
      });

      assert.equal(res.statusCode, 400);
    });

    it('allows Teacher A to add a valid question with secret answer key', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/quizzes/${teacherAQuizId}/questions`,
        headers: { authorization: `Bearer ${teacherAToken}` },
        payload: {
          prompt: 'Which protocol encrypts HTTP traffic?',
          timeLimitSec: 15,
          basePoints: 1000,
          options: [
            { optionText: 'HTTPS (TLS)', isCorrect: true },
            { optionText: 'FTP', isCorrect: false },
            { optionText: 'Telnet', isCorrect: false },
            { optionText: 'SNMP', isCorrect: false }
          ]
        }
      });

      assert.equal(res.statusCode, 201);
      const json = JSON.parse(res.body);
      assert.equal(json.question.optionsCount, 4);
    });
  });

  describe('Anti-IDOR / BOLA Tenant Isolation', () => {
    it('blocks Teacher B from accessing Teacher A\'s quiz details (404 Not Found)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/quizzes/${teacherAQuizId}`,
        headers: { authorization: `Bearer ${teacherBToken}` }
      });

      // Returns 404 to avoid leaking existence of another teacher's private resource
      assert.equal(res.statusCode, 404);
      const json = JSON.parse(res.body);
      assert.match(json.message, /not found or you do not have permission/i);
    });

    it('blocks Teacher B from modifying Teacher A\'s quiz title (404 Not Found)', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `/api/v1/quizzes/${teacherAQuizId}`,
        headers: { authorization: `Bearer ${teacherBToken}` },
        payload: {
          title: 'Hacked by Teacher B'
        }
      });

      assert.equal(res.statusCode, 404);

      // Verify Teacher A's quiz was NOT modified
      const quiz = db.getQuizById(teacherAQuizId);
      assert.equal(quiz.title, 'Introduction to Web Security');
    });

    it('blocks Teacher B from adding questions to Teacher A\'s quiz (404 Not Found)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/quizzes/${teacherAQuizId}/questions`,
        headers: { authorization: `Bearer ${teacherBToken}` },
        payload: {
          prompt: 'Malicious question inserted by Teacher B?',
          options: [
            { optionText: 'Option 1', isCorrect: true },
            { optionText: 'Option 2', isCorrect: false }
          ]
        }
      });

      assert.equal(res.statusCode, 404);
    });

    it('blocks Teacher B from deleting Teacher A\'s quiz (404 Not Found)', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/quizzes/${teacherAQuizId}`,
        headers: { authorization: `Bearer ${teacherBToken}` }
      });

      assert.equal(res.statusCode, 404);

      // Verify quiz still exists
      const quiz = db.getQuizById(teacherAQuizId);
      assert.ok(quiz);
    });

    it('ensures Teacher B\'s quiz list does NOT leak Teacher A\'s quiz', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/quizzes',
        headers: { authorization: `Bearer ${teacherBToken}` }
      });

      assert.equal(res.statusCode, 200);
      const json = JSON.parse(res.body);
      assert.equal(json.quizzes.length, 0); // Teacher B has created 0 quizzes
    });
  });

  describe('Legitimate Quiz Lifecycle for Owner', () => {
    it('allows Teacher A to retrieve full quiz details including questions & secret options', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/quizzes/${teacherAQuizId}`,
        headers: { authorization: `Bearer ${teacherAToken}` }
      });

      assert.equal(res.statusCode, 200);
      const json = JSON.parse(res.body);
      assert.equal(json.quiz.title, 'Introduction to Web Security');
      assert.equal(json.quiz.questions.length, 1);
      assert.equal(json.quiz.questions[0].options.length, 4);

      // Verify teacher can see which option is correct for authoring
      const correctOption = json.quiz.questions[0].options.find((o: any) => o.is_correct === true);
      assert.ok(correctOption);
      assert.equal(correctOption.option_text, 'HTTPS (TLS)');
    });

    it('allows Teacher A to update quiz title', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `/api/v1/quizzes/${teacherAQuizId}`,
        headers: { authorization: `Bearer ${teacherAToken}` },
        payload: {
          title: 'Advanced Web Security'
        }
      });

      assert.equal(res.statusCode, 200);
      const quiz = db.getQuizById(teacherAQuizId);
      assert.equal(quiz.title, 'Advanced Web Security');
    });

    it('allows Teacher A to delete own quiz and cascades questions', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/quizzes/${teacherAQuizId}`,
        headers: { authorization: `Bearer ${teacherAToken}` }
      });

      assert.equal(res.statusCode, 200);
      const quiz = db.getQuizById(teacherAQuizId);
      assert.equal(quiz, null);

      // Verify cascaded deletion of questions
      const questions = db.getQuestionsForQuiz(teacherAQuizId);
      assert.equal(questions.length, 0);
    });
  });
});
