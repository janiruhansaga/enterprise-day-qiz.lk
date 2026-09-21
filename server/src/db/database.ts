import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { UserRole } from '../config/security.js';
import { IDatastore, UserRecord, QuizRecord, QuizUpdatePayload, QuestionRecord, OptionRecord, PublicQuestion, SecretAnswerKey, GameSessionRecord, SessionUpdatePayload, ParticipantRecord, GameResponseRecord } from './datastore.interface.js';

export { UserRecord, QuizRecord, QuizUpdatePayload, QuestionRecord, OptionRecord, PublicQuestion, SecretAnswerKey, GameSessionRecord, SessionUpdatePayload, ParticipantRecord, GameResponseRecord };

const USER_ROLE_VALUES: readonly string[] = [UserRole.STUDENT, UserRole.TEACHER, UserRole.ADMIN];

function toUserRole(value: unknown): UserRole | null {
  return typeof value === 'string' && USER_ROLE_VALUES.includes(value) ? (value as UserRole) : null;
}

function mapUserRow(row: Record<string, unknown> | undefined): UserRecord | null {
  if (!row) return null;
  const role = toUserRole(row.role);
  if (
    typeof row.id !== 'string' ||
    typeof row.email !== 'string' ||
    typeof row.password_hash !== 'string' ||
    typeof row.display_name !== 'string' ||
    typeof row.created_at !== 'number' ||
    role === null
  ) {
    return null;
  }
  return {
    id: row.id,
    email: row.email,
    password_hash: row.password_hash,
    role,
    display_name: row.display_name,
    created_at: row.created_at
  };
}

export class DatabaseService implements IDatastore {
  private db: DatabaseSync;

  constructor(dbPath: string = ':memory:') {
    if (dbPath !== ':memory:') {
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
    this.db = new DatabaseSync(dbPath);
    this.initSchema();
  }

  private initSchema() {
    this.db.exec(`
      PRAGMA foreign_keys = ON;

      -- Users Table
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('STUDENT', 'TEACHER', 'ADMIN')),
        display_name TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

      -- Quizzes Table
      CREATE TABLE IF NOT EXISTS quizzes (
        id TEXT PRIMARY KEY,
        teacher_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        is_published INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_quizzes_teacher ON quizzes(teacher_id);

      -- Questions Table
      CREATE TABLE IF NOT EXISTS questions (
        id TEXT PRIMARY KEY,
        quiz_id TEXT NOT NULL,
        order_index INTEGER NOT NULL,
        prompt TEXT NOT NULL,
        time_limit_sec INTEGER NOT NULL DEFAULT 20,
        base_points INTEGER NOT NULL DEFAULT 1000,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_questions_quiz ON questions(quiz_id, order_index);

      -- Answer Options Table (Contains Secret 'is_correct' column)
      CREATE TABLE IF NOT EXISTS answer_options (
        id TEXT PRIMARY KEY,
        question_id TEXT NOT NULL,
        option_text TEXT NOT NULL,
        order_index INTEGER NOT NULL,
        is_correct INTEGER NOT NULL DEFAULT 0 CHECK(is_correct IN (0, 1)),
        FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_options_question ON answer_options(question_id);

      -- Game Sessions Table
      CREATE TABLE IF NOT EXISTS game_sessions (
        id TEXT PRIMARY KEY,
        pin TEXT UNIQUE NOT NULL,
        quiz_id TEXT NOT NULL,
        host_teacher_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('LOBBY', 'QUESTION_ACTIVE', 'QUESTION_RESULTS', 'LEADERBOARD', 'FINISHED')) DEFAULT 'LOBBY',
        current_question_index INTEGER NOT NULL DEFAULT 0,
        current_question_id TEXT,
        question_start_time INTEGER,
        question_deadline INTEGER,
        round_nonce TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE,
        FOREIGN KEY (host_teacher_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (current_question_id) REFERENCES questions(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_pin ON game_sessions(pin);
      CREATE INDEX IF NOT EXISTS idx_sessions_teacher ON game_sessions(host_teacher_id);

      -- Participants Table
      CREATE TABLE IF NOT EXISTS participants (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        user_id TEXT,
        nickname TEXT NOT NULL,
        total_score INTEGER NOT NULL DEFAULT 0,
        streak_count INTEGER NOT NULL DEFAULT 0,
        is_connected INTEGER NOT NULL DEFAULT 1,
        joined_at INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES game_sessions(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT uq_session_nickname UNIQUE(session_id, nickname)
      );

      CREATE INDEX IF NOT EXISTS idx_participants_session ON participants(session_id);

      -- Game Responses Table (Write-Once, Atomic, Replay Protected)
      CREATE TABLE IF NOT EXISTS game_responses (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        participant_id TEXT NOT NULL,
        question_id TEXT NOT NULL,
        selected_option_id TEXT NOT NULL,
        is_correct INTEGER NOT NULL CHECK(is_correct IN (0, 1)),
        points_awarded INTEGER NOT NULL,
        response_time_ms INTEGER NOT NULL,
        submitted_at INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES game_sessions(id) ON DELETE CASCADE,
        FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE,
        FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE,
        FOREIGN KEY (selected_option_id) REFERENCES answer_options(id) ON DELETE CASCADE,
        -- CRITICAL SECURITY CONSTRAINT: Exactly one answer per participant per question
        CONSTRAINT uq_response_single_answer UNIQUE(session_id, participant_id, question_id)
      );

      CREATE INDEX IF NOT EXISTS idx_responses_session_question ON game_responses(session_id, question_id);
    `);
  }

  // --- USER METHODS ---
  public createUser(user: UserRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO users (id, email, password_hash, role, display_name, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(user.id, user.email, user.password_hash, user.role, user.display_name, user.created_at);
  }

  public upsertTeacherUser(user: UserRecord): void {
    const existingById = this.findUserById(user.id);
    if (existingById) {
      this.db.prepare(`
        UPDATE users SET email = ?, role = ?, display_name = ? WHERE id = ?
      `).run(user.email, user.role, user.display_name, user.id);
      return;
    }
    const existingByEmail = this.findUserByEmail(user.email);
    if (existingByEmail) {
      this.db.prepare(`
        UPDATE users SET id = ?, role = ?, display_name = ? WHERE email = ?
      `).run(user.id, user.role, user.display_name, user.email);
      return;
    }
    this.createUser(user);
  }

  public findUserByEmail(email: string): UserRecord | null {
    const stmt = this.db.prepare(`
      SELECT id, email, password_hash, role, display_name, created_at
      FROM users
      WHERE email = ?
    `);
    return mapUserRow(stmt.get(email) as Record<string, unknown> | undefined);
  }

  public findUserById(id: string): UserRecord | null {
    const stmt = this.db.prepare(`
      SELECT id, email, password_hash, role, display_name, created_at
      FROM users
      WHERE id = ?
    `);
    return mapUserRow(stmt.get(id) as Record<string, unknown> | undefined);
  }

  // --- QUIZ & QUESTION REPOSITORY (WITH STRICT DATA SEGREGATION) ---
  public createQuiz(quiz: { id: string; teacher_id: string; title: string; description: string; is_published: boolean; created_at: number; updated_at: number }): void {
    const stmt = this.db.prepare(`
      INSERT INTO quizzes (id, teacher_id, title, description, is_published, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(quiz.id, quiz.teacher_id, quiz.title, quiz.description, quiz.is_published ? 1 : 0, quiz.created_at, quiz.updated_at);
  }

  public getQuizById(quizId: string): any | null {
    const stmt = this.db.prepare(`SELECT * FROM quizzes WHERE id = ?`);
    return (stmt.get(quizId) as any) || null;
  }

  public getQuizzesByTeacher(teacherId: string): any[] {
    const stmt = this.db.prepare(`
      SELECT q.id, q.teacher_id, q.title, q.description, q.is_published, q.created_at, q.updated_at,
             COUNT(qs.id) as question_count
      FROM quizzes q
      LEFT JOIN questions qs ON qs.quiz_id = q.id
      WHERE q.teacher_id = ?
      GROUP BY q.id
      ORDER BY q.created_at DESC
    `);
    return stmt.all(teacherId) as any[];
  }

  public getQuizWithDetailsForTeacher(quizId: string, teacherId: string): any | null {
    const qStmt = this.db.prepare(`SELECT * FROM quizzes WHERE id = ? AND teacher_id = ?`);
    const quiz = qStmt.get(quizId, teacherId) as any;
    if (!quiz) return null;

    const questionsStmt = this.db.prepare(`
      SELECT id, order_index, prompt, time_limit_sec, base_points
      FROM questions
      WHERE quiz_id = ?
      ORDER BY order_index ASC
    `);
    const questions = questionsStmt.all(quizId) as any[];

    const optStmt = this.db.prepare(`
      SELECT id, option_text, order_index, is_correct
      FROM answer_options
      WHERE question_id = ?
      ORDER BY order_index ASC
    `);

    for (const q of questions) {
      q.options = (optStmt.all(q.id) as any[]).map(o => ({
        ...o,
        is_correct: Boolean(o.is_correct)
      }));
    }

    return {
      ...quiz,
      is_published: Boolean(quiz.is_published),
      questions
    };
  }

  public updateQuiz(quizId: string, teacherId: string, updates: { title?: string; description?: string; is_published?: boolean }): boolean {
    const sets: string[] = ['updated_at = ?'];
    const values: any[] = [Date.now()];

    if (updates.title !== undefined) {
      sets.push('title = ?');
      values.push(updates.title);
    }
    if (updates.description !== undefined) {
      sets.push('description = ?');
      values.push(updates.description);
    }
    if (updates.is_published !== undefined) {
      sets.push('is_published = ?');
      values.push(updates.is_published ? 1 : 0);
    }

    values.push(quizId, teacherId);
    const stmt = this.db.prepare(`UPDATE quizzes SET ${sets.join(', ')} WHERE id = ? AND teacher_id = ?`);
    const res = stmt.run(...values) as any;
    return res.changes > 0;
  }

  public getNextQuestionOrder(quizId: string): number {
    const stmt = this.db.prepare(`SELECT MAX(order_index) as max_order FROM questions WHERE quiz_id = ?`);
    const row = stmt.get(quizId) as any;
    return (row?.max_order !== null && row?.max_order !== undefined) ? row.max_order + 1 : 1;
  }

  public deleteQuiz(quizId: string, teacherId: string): boolean {
    const stmt = this.db.prepare(`DELETE FROM quizzes WHERE id = ? AND teacher_id = ?`);
    const result = stmt.run(quizId, teacherId) as any;
    return result.changes > 0;
  }

  public addQuestionWithSecretAnswers(
    question: { id: string; quiz_id: string; order_index: number; prompt: string; time_limit_sec: number; base_points: number; created_at: number },
    options: Array<{ id: string; option_text: string; order_index: number; is_correct: boolean }>
  ): void {
    // Atomic insert of question and secret options
    this.db.exec('BEGIN TRANSACTION;');
    try {
      const qStmt = this.db.prepare(`
        INSERT INTO questions (id, quiz_id, order_index, prompt, time_limit_sec, base_points, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      qStmt.run(question.id, question.quiz_id, question.order_index, question.prompt, question.time_limit_sec, question.base_points, question.created_at);

      const optStmt = this.db.prepare(`
        INSERT INTO answer_options (id, question_id, option_text, order_index, is_correct)
        VALUES (?, ?, ?, ?, ?)
      `);
      for (const opt of options) {
        optStmt.run(opt.id, question.id, opt.option_text, opt.order_index, opt.is_correct ? 1 : 0);
      }
      this.db.exec('COMMIT;');
    } catch (err) {
      this.db.exec('ROLLBACK;');
      throw err;
    }
  }

  /**
   * ZERO-TRUST SANITIZED QUESTION FOR STUDENTS:
   * Explicitly strips 'is_correct' field. No student query can ever inspect the correct answer.
   */
  public getPublicQuestionForStudent(questionId: string): {
    id: string;
    prompt: string;
    order_index: number;
    time_limit_sec: number;
    base_points: number;
    options: Array<{ id: string; option_text: string; order_index: number }>;
  } | null {
    const qStmt = this.db.prepare(`
      SELECT id, prompt, order_index, time_limit_sec, base_points
      FROM questions
      WHERE id = ?
    `);
    const qRow = qStmt.get(questionId) as any;
    if (!qRow) return null;

    // Notice: 'is_correct' is strictly excluded from this query!
    const optStmt = this.db.prepare(`
      SELECT id, option_text, order_index
      FROM answer_options
      WHERE question_id = ?
      ORDER BY order_index ASC
    `);
    const options = optStmt.all(questionId) as any[];

    return {
      id: qRow.id,
      prompt: qRow.prompt,
      order_index: qRow.order_index,
      time_limit_sec: qRow.time_limit_sec,
      base_points: qRow.base_points,
      options
    };
  }

  /**
   * AUTHORITATIVE ANSWER KEY (FOR SERVER SCORING ENGINE ONLY):
   * Never exposed to external network handlers.
   */
  public getSecretAnswerKey(questionId: string): {
    correctOptionId: string;
    time_limit_sec: number;
    base_points: number;
  } | null {
    const qStmt = this.db.prepare(`
      SELECT time_limit_sec, base_points FROM questions WHERE id = ?
    `);
    const q = qStmt.get(questionId) as any;
    if (!q) return null;

    const optStmt = this.db.prepare(`
      SELECT id FROM answer_options WHERE question_id = ? AND is_correct = 1
    `);
    const correctOpt = optStmt.get(questionId) as any;
    if (!correctOpt) return null;

    return {
      correctOptionId: correctOpt.id,
      time_limit_sec: q.time_limit_sec,
      base_points: q.base_points
    };
  }

  public getQuestionsForQuiz(quizId: string): any[] {
    const stmt = this.db.prepare(`
      SELECT id, order_index, prompt, time_limit_sec, base_points
      FROM questions
      WHERE quiz_id = ?
      ORDER BY order_index ASC
    `);
    return stmt.all(quizId) as any[];
  }

  // --- GAME SESSION & PARTICIPANT REPOSITORY ---
  public createGameSession(session: {
    id: string;
    pin: string;
    quiz_id: string;
    host_teacher_id: string;
    created_at: number;
  }): void {
    const stmt = this.db.prepare(`
      INSERT INTO game_sessions (id, pin, quiz_id, host_teacher_id, status, created_at)
      VALUES (?, ?, ?, ?, 'LOBBY', ?)
    `);
    stmt.run(session.id, session.pin, session.quiz_id, session.host_teacher_id, session.created_at);
  }

  public findSessionByPin(pin: string): any | null {
    const stmt = this.db.prepare(`SELECT * FROM game_sessions WHERE pin = ?`);
    return (stmt.get(pin) as any) || null;
  }

  public findSessionById(sessionId: string): any | null {
    const stmt = this.db.prepare(`SELECT * FROM game_sessions WHERE id = ?`);
    return (stmt.get(sessionId) as any) || null;
  }

  public updateSessionState(sessionId: string, updates: {
    status?: string;
    current_question_index?: number;
    current_question_id?: string | null;
    question_start_time?: number | null;
    question_deadline?: number | null;
    round_nonce?: string | null;
  }): void {
    const sets: string[] = [];
    const values: any[] = [];

    for (const [k, v] of Object.entries(updates)) {
      sets.push(`${k} = ?`);
      values.push(v);
    }
    values.push(sessionId);

    const stmt = this.db.prepare(`UPDATE game_sessions SET ${sets.join(', ')} WHERE id = ?`);
    stmt.run(...values);
  }

  public addParticipant(participant: {
    id: string;
    session_id: string;
    user_id?: string | null;
    nickname: string;
    joined_at: number;
  }): void {
    const stmt = this.db.prepare(`
      INSERT INTO participants (id, session_id, user_id, nickname, total_score, streak_count, is_connected, joined_at)
      VALUES (?, ?, ?, ?, 0, 0, 1, ?)
    `);
    stmt.run(participant.id, participant.session_id, participant.user_id || null, participant.nickname, participant.joined_at);
  }

  public getParticipant(participantId: string): any | null {
    const stmt = this.db.prepare(`SELECT * FROM participants WHERE id = ?`);
    return (stmt.get(participantId) as any) || null;
  }

  public removeParticipant(participantId: string): void {
    const stmt = this.db.prepare(`DELETE FROM participants WHERE id = ?`);
    stmt.run(participantId);
  }

  public getSessionParticipants(sessionId: string): any[] {
    const stmt = this.db.prepare(`
      SELECT id, nickname, total_score, streak_count, is_connected
      FROM participants
      WHERE session_id = ?
      ORDER BY total_score DESC
    `);
    return stmt.all(sessionId) as any[];
  }

  // --- ATOMIC ANSWER RECORDING & SCORE UPDATE ---
  /**
   * ATOMIC ANSWER SUBMISSION:
   * Guarantees that:
   * 1. Response is recorded.
   * 2. Participant score and streak are updated.
   * 3. Any duplicate answer violates UNIQUE constraint and rolls back transaction.
   */
  public recordAnswerAtomic(response: {
    id: string;
    session_id: string;
    participant_id: string;
    question_id: string;
    selected_option_id: string;
    is_correct: boolean;
    points_awarded: number;
    response_time_ms: number;
    submitted_at: number;
  }): void {
    this.db.exec('BEGIN TRANSACTION;');
    try {
      // 1. Insert write-once response
      const rStmt = this.db.prepare(`
        INSERT INTO game_responses (
          id, session_id, participant_id, question_id, selected_option_id,
          is_correct, points_awarded, response_time_ms, submitted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      rStmt.run(
        response.id,
        response.session_id,
        response.participant_id,
        response.question_id,
        response.selected_option_id,
        response.is_correct ? 1 : 0,
        response.points_awarded,
        response.response_time_ms,
        response.submitted_at
      );

      // 2. Update participant score and streak atomically
      if (response.is_correct) {
        const pStmt = this.db.prepare(`
          UPDATE participants
          SET total_score = total_score + ?,
              streak_count = streak_count + 1
          WHERE id = ?
        `);
        pStmt.run(response.points_awarded, response.participant_id);
      } else {
        const pStmt = this.db.prepare(`
          UPDATE participants
          SET streak_count = 0
          WHERE id = ?
        `);
        pStmt.run(response.participant_id);
      }

      this.db.exec('COMMIT;');
    } catch (err) {
      this.db.exec('ROLLBACK;');
      throw err;
    }
  }

  public hasParticipantAnswered(sessionId: string, participantId: string, questionId: string): boolean {
    const stmt = this.db.prepare(`
      SELECT id FROM game_responses
      WHERE session_id = ? AND participant_id = ? AND question_id = ?
    `);
    const row = stmt.get(sessionId, participantId, questionId);
    return !!row;
  }

  public countQuestionResponses(sessionId: string, questionId: string): number {
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM game_responses
      WHERE session_id = ? AND question_id = ?
    `);
    const row = stmt.get(sessionId, questionId) as any;
    return row?.count || 0;
  }

  public close() {
    this.db.close();
  }
}

// Singleton database instance
export const defaultDatabase = new DatabaseService(
  process.env.DB_PATH || path.resolve(process.cwd(), 'data', 'enterprise_quiz.sqlite')
);
