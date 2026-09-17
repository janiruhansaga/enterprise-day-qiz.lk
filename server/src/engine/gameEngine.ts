import crypto from 'node:crypto';
import { Server as SocketIOServer } from 'socket.io';
import { IDatastore } from '../db/datastore.interface.js';

export interface ActiveQuestionTimer {
  sessionId: string;
  questionId: string;
  timerHandle: NodeJS.Timeout;
  deadline: number;
}

export class GameEngine {
  private io: SocketIOServer;
  private db: IDatastore;
  private activeTimers: Map<string, ActiveQuestionTimer> = new Map();

  constructor(io: SocketIOServer, db: IDatastore) {
    this.io = io;
    this.db = db;
  }

  /**
   * Release and broadcast the next question to all participants in a game session.
   * STRICT ZERO-TRUST: Question options are stripped of all answer keys.
   */
  public async dispatchQuestion(sessionId: string, questionIndex: number): Promise<{ success: boolean; message?: string }> {
    const session = await this.db.findSessionById(sessionId);
    if (!session) {
      return { success: false, message: 'Session not found' };
    }

    const questions = await this.db.getQuestionsForQuiz(session.quiz_id);
    if (questionIndex < 0 || questionIndex >= questions.length) {
      return { success: false, message: 'Question index out of bounds' };
    }

    const questionMeta = questions[questionIndex];
    const publicQuestion = await this.db.getPublicQuestionForStudent(questionMeta.id);
    if (!publicQuestion) {
      return { success: false, message: 'Failed to load public question payload' };
    }

    // Double check: Guarantee zero correct-answer leakage
    for (const opt of publicQuestion.options) {
      if ('is_correct' in opt || 'isCorrect' in opt) {
        delete (opt as any).is_correct;
        delete (opt as any).isCorrect;
      }
    }

    // Clear any previously running timer for this session
    this.clearSessionTimer(sessionId);

    // Generate authoritative server timestamps & per-round nonce
    const now = Date.now();
    const durationMs = publicQuestion.time_limit_sec * 1000;
    const deadline = now + durationMs;
    const roundNonce = crypto.randomBytes(16).toString('hex');

    // Update database state atomically
    await this.db.updateSessionState(sessionId, {
      status: 'QUESTION_ACTIVE',
      current_question_index: questionIndex,
      current_question_id: publicQuestion.id,
      question_start_time: now,
      question_deadline: deadline,
      round_nonce: roundNonce
    });

    // Broadcast sanitized question payload to all connected clients in the session room
    this.io.to(`session:${sessionId}`).emit('game:question_started', {
      questionIndex,
      totalQuestions: questions.length,
      questionId: publicQuestion.id,
      prompt: publicQuestion.prompt,
      timeLimitSec: publicQuestion.time_limit_sec,
      durationSec: publicQuestion.time_limit_sec,
      basePoints: publicQuestion.base_points,
      serverStartTime: now,
      serverDeadline: deadline,
      roundNonce,
      options: publicQuestion.options.map(opt => ({
        id: opt.id,
        order_index: opt.order_index,
        option_text: opt.option_text,
        optionText: opt.option_text
      }))
    });

    // Schedule authoritative server-side timer
    const timerHandle = setTimeout(() => {
      this.handleQuestionTimerExpired(sessionId, publicQuestion.id);
    }, durationMs);

    this.activeTimers.set(sessionId, {
      sessionId,
      questionId: publicQuestion.id,
      timerHandle,
      deadline
    });

    return { success: true };
  }

  /**
   * Invoked automatically when the server timer expires.
   * Transitions session state to QUESTION_RESULTS.
   */
  public async handleQuestionTimerExpired(sessionId: string, questionId: string) {
    const active = this.activeTimers.get(sessionId);
    if (active) {
      clearTimeout(active.timerHandle);
      this.activeTimers.delete(sessionId);
    }

    try {
      const session = await this.db.findSessionById(sessionId);
      if (!session || session.current_question_id !== questionId || session.status !== 'QUESTION_ACTIVE') {
        return;
      }

      // Transition status to QUESTION_RESULTS
      await this.db.updateSessionState(sessionId, {
        status: 'QUESTION_RESULTS'
      });

      // Now, and ONLY now, reveal the correct answer option ID for this question
      const answerKey = await this.db.getSecretAnswerKey(questionId);

      this.io.to(`session:${sessionId}`).emit('game:question_ended', {
        questionId,
        correctOptionId: answerKey?.correctOptionId || null,
        reason: 'TIME_EXPIRED'
      });
    } catch {
      // Safely handle case if db was closed during teardown
    }
  }

  public clearSessionTimer(sessionId: string) {
    const active = this.activeTimers.get(sessionId);
    if (active) {
      clearTimeout(active.timerHandle);
      this.activeTimers.delete(sessionId);
    }
  }

  public getActiveTimer(sessionId: string): ActiveQuestionTimer | undefined {
    return this.activeTimers.get(sessionId);
  }
}
