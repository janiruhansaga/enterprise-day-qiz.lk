import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { DatabaseService } from '../src/db/database.js';
import { UserRole } from '../src/config/security.js';

describe('Phase 3: Database Schema & Security Rules Suite', () => {
  let db: DatabaseService;
  const teacherId = crypto.randomUUID();
  const studentId = crypto.randomUUID();
  const quizId = crypto.randomUUID();
  const questionId = crypto.randomUUID();
  const opt1Id = crypto.randomUUID();
  const opt2Id = crypto.randomUUID();
  const opt3Id = crypto.randomUUID();
  const opt4Id = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const participantId = crypto.randomUUID();

  before(() => {
    db = new DatabaseService(':memory:');

    // Create teacher
    db.createUser({
      id: teacherId,
      email: 'teacher@school.edu',
      password_hash: 'hash123',
      role: UserRole.TEACHER,
      display_name: 'ProfSmith',
      created_at: Date.now()
    });

    // Create student
    db.createUser({
      id: studentId,
      email: 'student@school.edu',
      password_hash: 'hash456',
      role: UserRole.STUDENT,
      display_name: 'StudentBob',
      created_at: Date.now()
    });
  });

  after(() => {
    db.close();
  });

  describe('Foreign Key Integrity & Cascading', () => {
    it('blocks quiz creation referencing non-existent teacher (FK violation)', () => {
      assert.throws(() => {
        db.createQuiz({
          id: crypto.randomUUID(),
          teacher_id: 'non-existent-teacher-id',
          title: 'Orphan Quiz',
          description: '',
          is_published: false,
          created_at: Date.now(),
          updated_at: Date.now()
        });
      }, /FOREIGN KEY constraint failed/);
    });

    it('successfully creates quiz for valid teacher', () => {
      db.createQuiz({
        id: quizId,
        teacher_id: teacherId,
        title: 'Cybersecurity Fundamentals',
        description: 'Test quiz for zero-trust security',
        is_published: true,
        created_at: Date.now(),
        updated_at: Date.now()
      });

      const quiz = db.getQuizById(quizId);
      assert.ok(quiz);
      assert.equal(quiz.title, 'Cybersecurity Fundamentals');
      assert.equal(quiz.teacher_id, teacherId);
    });
  });

  describe('Data Partitioning & Secret Answer Concealment', () => {
    it('stores question and secret answers atomically', () => {
      db.addQuestionWithSecretAnswers(
        {
          id: questionId,
          quiz_id: quizId,
          order_index: 1,
          prompt: 'Which HTTP header prevents client JS from reading auth tokens?',
          time_limit_sec: 15,
          base_points: 1000,
          created_at: Date.now()
        },
        [
          { id: opt1Id, option_text: 'X-Frame-Options', order_index: 0, is_correct: false },
          { id: opt2Id, option_text: 'HttpOnly', order_index: 1, is_correct: true }, // CORRECT ANSWER
          { id: opt3Id, option_text: 'Content-Type', order_index: 2, is_correct: false },
          { id: opt4Id, option_text: 'Access-Control-Allow-Origin', order_index: 3, is_correct: false }
        ]
      );

      const questions = db.getQuestionsForQuiz(quizId);
      assert.equal(questions.length, 1);
    });

    it('strictly omits is_correct in getPublicQuestionForStudent query', () => {
      const studentPayload = db.getPublicQuestionForStudent(questionId);
      assert.ok(studentPayload);
      assert.equal(studentPayload.prompt, 'Which HTTP header prevents client JS from reading auth tokens?');
      assert.equal(studentPayload.options.length, 4);

      // Verify that NO option has the is_correct field in the serialized object
      for (const opt of studentPayload.options) {
        assert.equal(
          (opt as any).is_correct,
          undefined,
          `Critical vulnerability: is_correct leaked in option ${opt.option_text}`
        );
      }
    });

    it('correctly retrieves secret answer key through server-only method', () => {
      const secretKey = db.getSecretAnswerKey(questionId);
      assert.ok(secretKey);
      assert.equal(secretKey.correctOptionId, opt2Id);
      assert.equal(secretKey.time_limit_sec, 15);
      assert.equal(secretKey.base_points, 1000);
    });
  });

  describe('Game Session & Participant Uniqueness Constraints', () => {
    it('creates game session with unique PIN and status LOBBY', () => {
      db.createGameSession({
        id: sessionId,
        pin: '849201',
        quiz_id: quizId,
        host_teacher_id: teacherId,
        created_at: Date.now()
      });

      const session = db.findSessionByPin('849201');
      assert.ok(session);
      assert.equal(session.status, 'LOBBY');
      assert.equal(session.quiz_id, quizId);
    });

    it('rejects duplicate game PIN (Unique constraint violation)', () => {
      assert.throws(() => {
        db.createGameSession({
          id: crypto.randomUUID(),
          pin: '849201', // Same PIN
          quiz_id: quizId,
          host_teacher_id: teacherId,
          created_at: Date.now()
        });
      }, /UNIQUE constraint failed/);
    });

    it('adds participant and blocks duplicate nicknames in same session', () => {
      db.addParticipant({
        id: participantId,
        session_id: sessionId,
        user_id: studentId,
        nickname: 'AliceInWonderland',
        joined_at: Date.now()
      });

      const p = db.getParticipant(participantId);
      assert.ok(p);
      assert.equal(p.nickname, 'AliceInWonderland');
      assert.equal(p.total_score, 0);

      // Attempt duplicate nickname in the same game session
      assert.throws(() => {
        db.addParticipant({
          id: crypto.randomUUID(),
          session_id: sessionId,
          user_id: null,
          nickname: 'AliceInWonderland',
          joined_at: Date.now()
        });
      }, /UNIQUE constraint failed: participants\.session_id, participants\.nickname/);
    });
  });

  describe('Atomic Game Responses & Duplicate Submission Prevention', () => {
    it('records first answer atomically and updates score and streak', () => {
      const hasAnsweredBefore = db.hasParticipantAnswered(sessionId, participantId, questionId);
      assert.equal(hasAnsweredBefore, false);

      db.recordAnswerAtomic({
        id: crypto.randomUUID(),
        session_id: sessionId,
        participant_id: participantId,
        question_id: questionId,
        selected_option_id: opt2Id, // correct
        is_correct: true,
        points_awarded: 950,
        response_time_ms: 1200,
        submitted_at: Date.now()
      });

      const hasAnsweredAfter = db.hasParticipantAnswered(sessionId, participantId, questionId);
      assert.equal(hasAnsweredAfter, true);

      // Verify participant score was updated atomically
      const updatedParticipant = db.getParticipant(participantId);
      assert.equal(updatedParticipant.total_score, 950);
      assert.equal(updatedParticipant.streak_count, 1);
    });

    it('strictly rejects second answer for same question (Unique constraint / Replay protection)', () => {
      assert.throws(() => {
        db.recordAnswerAtomic({
          id: crypto.randomUUID(),
          session_id: sessionId,
          participant_id: participantId,
          question_id: questionId, // Duplicate question answer
          selected_option_id: opt1Id,
          is_correct: false,
          points_awarded: 0,
          response_time_ms: 2000,
          submitted_at: Date.now()
        });
      }, /UNIQUE constraint failed: game_responses\.session_id, game_responses\.participant_id, game_responses\.question_id/);

      // Verify participant score was NOT modified and transaction rolled back
      const participant = db.getParticipant(participantId);
      assert.equal(participant.total_score, 950);
      assert.equal(participant.streak_count, 1);
    });
  });
});
