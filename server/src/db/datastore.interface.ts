import { UserRole } from '../config/security.js';

export type MaybePromise<T> = Promise<T> | T;

export interface UserRecord {
  id: string;
  email: string;
  password_hash: string;
  role: UserRole;
  display_name: string;
  created_at: number;
}

export interface QuizRecord {
  id: string;
  teacher_id: string;
  title: string;
  description: string;
  is_published: boolean;
  created_at: number;
  updated_at: number;
}

export interface QuizUpdatePayload {
  title?: string;
  description?: string;
  is_published?: boolean;
}

export interface QuestionRecord {
  id: string;
  quiz_id: string;
  order_index: number;
  prompt: string;
  time_limit_sec: number;
  base_points: number;
  created_at: number;
}

export interface OptionRecord {
  id: string;
  option_text: string;
  order_index: number;
  is_correct: boolean;
}

export interface PublicQuestion {
  id: string;
  prompt: string;
  order_index: number;
  time_limit_sec: number;
  base_points: number;
  options: Array<{ id: string; option_text: string; order_index: number }>;
}

export interface SecretAnswerKey {
  correctOptionId: string;
  time_limit_sec: number;
  base_points: number;
}

export interface GameSessionRecord {
  id: string;
  pin: string;
  quiz_id: string;
  host_teacher_id: string;
  created_at: number;
  status?: string;
  current_question_index?: number;
  current_question_id?: string | null;
  question_start_time?: number | null;
  question_deadline?: number | null;
  round_nonce?: string | null;
}

export interface SessionUpdatePayload {
  status?: string;
  current_question_index?: number;
  current_question_id?: string | null;
  question_start_time?: number | null;
  question_deadline?: number | null;
  round_nonce?: string | null;
}

export interface ParticipantRecord {
  id: string;
  session_id: string;
  user_id?: string | null;
  nickname: string;
  total_score?: number;
  streak_count?: number;
  is_connected?: number | boolean;
  joined_at: number;
}

export interface GameResponseRecord {
  id: string;
  session_id: string;
  participant_id: string;
  question_id: string;
  selected_option_id: string;
  is_correct: boolean;
  points_awarded: number;
  response_time_ms: number;
  submitted_at: number;
}

/**
 * Universal Datastore Interface
 * Implemented by:
 * 1. DatabaseService (SQLite for local development and rapid in-memory tests)
 * 2. FirestoreDatastore (Google Cloud Firestore for cloud production)
 */
export interface IDatastore {
  createUser(user: UserRecord): MaybePromise<void>;
  upsertTeacherUser?(user: UserRecord): MaybePromise<void>;
  findUserByEmail(email: string): MaybePromise<UserRecord | null>;
  findUserById(id: string): MaybePromise<UserRecord | null>;

  createQuiz(quiz: QuizRecord): MaybePromise<void>;
  getQuizById(quizId: string): MaybePromise<any | null>;
  getQuizzesByTeacher(teacherId: string): MaybePromise<any[]>;
  getQuizWithDetailsForTeacher(quizId: string, teacherId: string): MaybePromise<any | null>;
  updateQuiz(quizId: string, teacherId: string, updates: QuizUpdatePayload): MaybePromise<boolean>;
  getNextQuestionOrder(quizId: string): MaybePromise<number>;
  deleteQuiz(quizId: string, teacherId: string): MaybePromise<boolean>;

  addQuestionWithSecretAnswers(question: QuestionRecord, options: OptionRecord[]): MaybePromise<void>;
  getPublicQuestionForStudent(questionId: string): MaybePromise<PublicQuestion | null>;
  getSecretAnswerKey(questionId: string): MaybePromise<SecretAnswerKey | null>;
  getQuestionsForQuiz(quizId: string): MaybePromise<any[]>;

  createGameSession(session: GameSessionRecord): MaybePromise<void>;
  findSessionByPin(pin: string): MaybePromise<any | null>;
  findSessionById(sessionId: string): MaybePromise<any | null>;
  updateSessionState(sessionId: string, updates: SessionUpdatePayload): MaybePromise<void>;

  addParticipant(participant: ParticipantRecord): MaybePromise<void>;
  getParticipant(participantId: string): MaybePromise<any | null>;
  removeParticipant(participantId: string): MaybePromise<void>;
  getSessionParticipants(sessionId: string): MaybePromise<any[]>;

  recordAnswerAtomic(response: GameResponseRecord): MaybePromise<void>;
  hasParticipantAnswered(sessionId: string, participantId: string, questionId: string): MaybePromise<boolean>;
  countQuestionResponses?(sessionId: string, questionId: string): MaybePromise<number>;

  close?(): MaybePromise<void>;
}
