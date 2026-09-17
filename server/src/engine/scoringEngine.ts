import crypto from 'node:crypto';
import { IDatastore } from '../db/datastore.interface.js';

export interface AnswerSubmissionResult {
  success: boolean;
  code?: 'INVALID_STATE' | 'QUESTION_MISMATCH' | 'INVALID_NONCE' | 'DEADLINE_EXCEEDED' | 'DUPLICATE_ANSWER' | 'INTERNAL_ERROR' | 'PARTICIPANT_NOT_ACTIVE';
  message?: string;
  isCorrect?: boolean;
  pointsAwarded?: number;
  totalScore?: number;
  streakCount?: number;
  responseTimeMs?: number;
}

export class ScoringEngine {
  private db: IDatastore;
  // In-memory set for zero-window race condition mutex locking
  private inFlightSubmissions: Set<string> = new Set();

  constructor(db: IDatastore) {
    this.db = db;
  }

  /**
   * SERVER-AUTHORITATIVE ANSWER EVALUATION:
   * 1. Validates game session state and question active status.
   * 2. Enforces cryptographic round nonce (anti-replay).
   * 3. Evaluates authoritative arrival time against server deadline + 500ms grace.
   * 4. Evaluates correctness and computes points on the server.
   * 5. Atomically commits response and updates score.
   */
  public async submitAnswer(params: {
    sessionId: string;
    participantId: string;
    questionId: string;
    selectedOptionId: string;
    roundNonce: string;
    serverReceivedTime?: number;
  }): Promise<AnswerSubmissionResult> {
    const receivedAt = params.serverReceivedTime || Date.now();
    const lockKey = `${params.sessionId}:${params.participantId}:${params.questionId}`;

    // Memory-level Mutex: block simultaneous parallel requests from the same participant
    if (this.inFlightSubmissions.has(lockKey)) {
      return {
        success: false,
        code: 'DUPLICATE_ANSWER',
        message: 'Answer submission already in progress'
      };
    }
    this.inFlightSubmissions.add(lockKey);

    try {
      // 1. Verify session exists and is in QUESTION_ACTIVE state
      const session = await this.db.findSessionById(params.sessionId);
      if (!session || session.status !== 'QUESTION_ACTIVE') {
        return {
          success: false,
          code: 'INVALID_STATE',
          message: 'Game is not currently accepting answers'
        };
      }

      // 2. Verify current question ID matches
      if (session.current_question_id !== params.questionId) {
        return {
          success: false,
          code: 'QUESTION_MISMATCH',
          message: 'Submitted question does not match active question'
        };
      }

      // 3. Verify cryptographic round nonce (Anti-Replay)
      if (session.round_nonce !== params.roundNonce) {
        return {
          success: false,
          code: 'INVALID_NONCE',
          message: 'Invalid or expired round nonce'
        };
      }

      // 4. Server-Authoritative Deadline Check (with strict 500ms network transit grace)
      const GRACE_PERIOD_MS = 500;
      const effectiveDeadline = (session.question_deadline || 0) + GRACE_PERIOD_MS;
      const startTime = session.question_start_time || receivedAt;

      if (receivedAt > effectiveDeadline) {
        return {
          success: false,
          code: 'DEADLINE_EXCEEDED',
          message: 'Answer arrived after the server deadline'
        };
      }

      // 5. Database duplicate check
      const alreadyAnswered = await this.db.hasParticipantAnswered(
        params.sessionId,
        params.participantId,
        params.questionId
      );
      if (alreadyAnswered) {
        return {
          success: false,
          code: 'DUPLICATE_ANSWER',
          message: 'You have already submitted an answer for this question'
        };
      }

      // 5b. Verify participant exists and is active in database
      const participant = await this.db.getParticipant(params.participantId);
      if (!participant || !participant.is_connected) {
        return {
          success: false,
          code: 'PARTICIPANT_NOT_ACTIVE',
          message: 'Participant is not active in this session'
        };
      }

      // 6. Server-Side Correctness & Scoring Calculation
      const secretKey = await this.db.getSecretAnswerKey(params.questionId);
      if (!secretKey) {
        return {
          success: false,
          code: 'INTERNAL_ERROR',
          message: 'Could not load authoritative answer key'
        };
      }

      const isCorrect = secretKey.correctOptionId === params.selectedOptionId;
      const durationMs = (secretKey.time_limit_sec || 20) * 1000;
      const responseTimeMs = Math.max(0, receivedAt - startTime);

      let pointsAwarded = 0;
      const currentStreak = participant.streak_count || 0;

      if (isCorrect) {
        // Fast answer scoring formula:
        // Base points: 500 to 1000 scaled linearly by remaining time ratio
        const timeRatio = Math.max(0, Math.min(1, 1 - (responseTimeMs / durationMs)));
        const baseScore = Math.round(500 + 500 * timeRatio);
        
        // Streak multiplier: 1x, 1.1x, 1.2x (capped at 1.5x)
        const streakMultiplier = Math.min(1.5, 1 + currentStreak * 0.1);
        pointsAwarded = Math.round(baseScore * streakMultiplier);
      }

      // 7. Atomic Write to Database (Response + Participant Score update)
      const responseId = crypto.randomUUID();
      try {
        await this.db.recordAnswerAtomic({
          id: responseId,
          session_id: params.sessionId,
          participant_id: params.participantId,
          question_id: params.questionId,
          selected_option_id: params.selectedOptionId,
          is_correct: isCorrect,
          points_awarded: pointsAwarded,
          response_time_ms: responseTimeMs,
          submitted_at: receivedAt
        });
      } catch (dbErr: any) {
        if (dbErr.message && dbErr.message.includes('UNIQUE constraint failed')) {
          return {
            success: false,
            code: 'DUPLICATE_ANSWER',
            message: 'Duplicate answer detected by database constraint'
          };
        }
        throw dbErr;
      }

      // 8. Fetch updated participant state
      const updatedParticipant = await this.db.getParticipant(params.participantId);

      return {
        success: true,
        isCorrect,
        pointsAwarded,
        totalScore: updatedParticipant?.total_score || 0,
        streakCount: updatedParticipant?.streak_count || 0,
        responseTimeMs
      };
    } finally {
      this.inFlightSubmissions.delete(lockKey);
    }
  }

  /**
   * Count total submitted answers for the current question in a session.
   */
  public countAnswersForQuestion(sessionId: string, questionId: string): number | Promise<number> {
    if (this.db.countQuestionResponses) {
      return this.db.countQuestionResponses(sessionId, questionId);
    }
    return 0;
  }
}
