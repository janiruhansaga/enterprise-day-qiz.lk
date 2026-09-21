import crypto from 'node:crypto';
import { IDatastore, SessionPublicState } from '../db/datastore.interface.js';
import { LeaderboardEngine } from './leaderboardEngine.js';

async function cleanQuestionPayload(db: IDatastore, questionId: string) {
  const publicQuestion = await db.getPublicQuestionForStudent(questionId);
  if (!publicQuestion) return null;
  for (const opt of publicQuestion.options) {
    if ('is_correct' in opt || 'isCorrect' in opt) {
      delete (opt as any).is_correct;
      delete (opt as any).isCorrect;
    }
  }
  return publicQuestion;
}

export async function buildPublicState(db: IDatastore, session: any): Promise<SessionPublicState> {
  const sessionId = session.id;
  const quiz = await db.getQuizById(session.quiz_id);
  const questions = await db.getQuestionsForQuiz(session.quiz_id);

  const state: SessionPublicState = {
    sessionId,
    status: session.status || 'LOBBY',
    quizTitle: quiz?.title,
    currentQuestionIndex: session.current_question_index ?? null,
    totalQuestions: questions.length,
    currentQuestionId: session.current_question_id || null,
    prompt: null,
    timeLimitSec: null,
    basePoints: null,
    serverStartTime: null,
    serverDeadline: null,
    roundNonce: null,
    options: [],
    answersCount: 0,
    revealedCorrectOptionId: null,
    leaderboard: null,
    podium: null,
    updatedAt: Date.now()
  };

  if (session.current_question_id) {
    const publicQuestion = await cleanQuestionPayload(db, session.current_question_id);
    if (publicQuestion) {
      state.prompt = publicQuestion.prompt;
      state.timeLimitSec = publicQuestion.time_limit_sec;
      state.basePoints = publicQuestion.base_points;
      state.serverStartTime = session.question_start_time;
      state.serverDeadline = session.question_deadline;
      state.roundNonce = session.round_nonce;
      state.options = publicQuestion.options.map(opt => ({
        id: opt.id,
        option_text: opt.option_text,
        order_index: opt.order_index
      }));
      if (db.countQuestionResponses) {
        state.answersCount = await Promise.resolve(db.countQuestionResponses(session.id, session.current_question_id));
      }
    }
  }

  if (
    (session.status === 'QUESTION_RESULTS' || session.status === 'FINISHED') &&
    session.current_question_id
  ) {
    const answerKey = await db.getSecretAnswerKey(session.current_question_id);
    state.revealedCorrectOptionId = answerKey?.correctOptionId || null;
  }

  if (session.status === 'LEADERBOARD' || session.status === 'FINISHED') {
    const leaderboardEngine = new LeaderboardEngine(db);
    state.leaderboard = await Promise.resolve(leaderboardEngine.getLeaderboard(sessionId, 5));
    if (session.status === 'LEADERBOARD' && session.current_question_id) {
      const answerKey = await db.getSecretAnswerKey(session.current_question_id);
      state.revealedCorrectOptionId = answerKey?.correctOptionId || null;
    }
  }

  if (session.status === 'FINISHED') {
    const leaderboardEngine = new LeaderboardEngine(db);
    const { podium } = await Promise.resolve(leaderboardEngine.getFinalPodium(sessionId));
    state.podium = podium;
  }

  const participants = await db.getSessionParticipants(sessionId);
  state.totalParticipants = participants.length;

  return state;
}

export async function publishPublicState(db: IDatastore, session: any): Promise<void> {
  if (!db.publishSessionPublicState) return;
  const state = await buildPublicState(db, session);
  await db.publishSessionPublicState(session.id, state);
}

export async function dispatchQuestion(
  db: IDatastore,
  sessionId: string,
  questionIndex: number
): Promise<{ success: boolean; message?: string }> {
  const session = await db.findSessionById(sessionId);
  if (!session) {
    return { success: false, message: 'Session not found' };
  }

  const questions = await db.getQuestionsForQuiz(session.quiz_id);
  if (questionIndex < 0 || questionIndex >= questions.length) {
    return { success: false, message: 'Question index out of bounds' };
  }

  const publicQuestion = await cleanQuestionPayload(db, questions[questionIndex].id);
  if (!publicQuestion) {
    return { success: false, message: 'Failed to load public question payload' };
  }

  const now = Date.now();
  const durationMs = publicQuestion.time_limit_sec * 1000;
  const deadline = now + durationMs;
  const roundNonce = crypto.randomBytes(16).toString('hex');

  await db.updateSessionState(sessionId, {
    status: 'QUESTION_ACTIVE',
    current_question_index: questionIndex,
    current_question_id: publicQuestion.id,
    question_start_time: now,
    question_deadline: deadline,
    round_nonce: roundNonce
  });

  const updated = await db.findSessionById(sessionId);
  await publishPublicState(db, updated);

  return { success: true };
}

export async function ensureRoundEnded(
  db: IDatastore,
  sessionId: string,
  reason: string = 'ROUND_CLOSED'
): Promise<{ finished: boolean; correctOptionId: string | null; reason: string }> {
  const session = await db.findSessionById(sessionId);
  if (!session || session.status !== 'QUESTION_ACTIVE' || !session.current_question_id) {
    return { finished: false, correctOptionId: null, reason };
  }

  await db.updateSessionState(sessionId, {
    status: 'QUESTION_RESULTS'
  });

  const answerKey = await db.getSecretAnswerKey(session.current_question_id);
  const updated = await db.findSessionById(sessionId);
  await publishPublicState(db, updated);

  return { finished: true, correctOptionId: answerKey?.correctOptionId || null, reason };
}

export async function showLeaderboard(db: IDatastore, sessionId: string): Promise<void> {
  await db.updateSessionState(sessionId, {
    status: 'LEADERBOARD'
  });
  const updated = await db.findSessionById(sessionId);
  await publishPublicState(db, updated);
}

export async function finishGame(
  db: IDatastore,
  sessionId: string
): Promise<{ topThree: any[]; totalParticipants: number }> {
  await db.updateSessionState(sessionId, {
    status: 'FINISHED'
  });
  const updated = await db.findSessionById(sessionId);
  await publishPublicState(db, updated);

  const leaderboardEngine = new LeaderboardEngine(db);
  const { podium } = await Promise.resolve(leaderboardEngine.getFinalPodium(sessionId));
  return podium;
}