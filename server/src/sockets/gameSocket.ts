import { Server as SocketIOServer, Socket } from 'socket.io';
import crypto from 'node:crypto';
import { IDatastore } from '../db/datastore.interface.js';
import { JoinGameSchema, KickParticipantSchema } from '../game/schemas.js';
import { verifyAuthToken, signAuthToken } from '../auth/crypto.js';
import { verifyAnyToken } from '../middleware/auth.js';
import { UserRole } from '../config/security.js';
import { GameEngine } from '../engine/gameEngine.js';
import { ScoringEngine } from '../engine/scoringEngine.js';
import { LeaderboardEngine } from '../engine/leaderboardEngine.js';
import { SubmitAnswerSchema } from '../game/answerSchemas.js';
import { isAppropriateNickname } from '../security/sanitizer.js';
import { defaultRevocationService } from '../auth/revocation.js';
import { TokenBucketRateLimiter } from '../middleware/rateLimiter.js';

export interface AuthenticatedSocketData {
  userId?: string;
  role?: UserRole;
  participantId?: string;
  sessionId?: string;
  nickname?: string;
  isTeacher?: boolean;
}

export class GameSocketManager {
  private io: SocketIOServer;
  private db: IDatastore;
  private gameEngine: GameEngine;
  private scoringEngine: ScoringEngine;
  private leaderboardEngine: LeaderboardEngine;
  private pinRateLimiter: TokenBucketRateLimiter;

  constructor(
    io: SocketIOServer,
    db: IDatastore,
    gameEngine?: GameEngine,
    scoringEngine?: ScoringEngine,
    leaderboardEngine?: LeaderboardEngine,
    pinRateLimiter?: TokenBucketRateLimiter
  ) {
    this.io = io;
    this.db = db;
    this.gameEngine = gameEngine || new GameEngine(io, db);
    this.scoringEngine = scoringEngine || new ScoringEngine(db);
    this.leaderboardEngine = leaderboardEngine || new LeaderboardEngine(db);
    this.pinRateLimiter = pinRateLimiter || new TokenBucketRateLimiter(5, 60 * 1000);
    this.setupEventHandlers();
  }

  public getPinRateLimiter(): TokenBucketRateLimiter {
    return this.pinRateLimiter;
  }

  public getGameEngine(): GameEngine {
    return this.gameEngine;
  }

  public getScoringEngine(): ScoringEngine {
    return this.scoringEngine;
  }

  public getLeaderboardEngine(): LeaderboardEngine {
    return this.leaderboardEngine;
  }

  private setupEventHandlers() {
    this.io.on('connection', (socket: Socket) => {
      const socketData: AuthenticatedSocketData = {};

      // 1. Student joins game via PIN and Nickname
      socket.on('game:join', async (payload: unknown, ack?: (res: any) => void) => {
        try {
          const parseResult = JoinGameSchema.safeParse(payload);
          if (!parseResult.success) {
            const errResponse = {
              success: false,
              code: 'INVALID_PAYLOAD',
              message: 'Invalid join parameters',
              errors: parseResult.error.flatten().fieldErrors
            };
            if (ack) return ack(errResponse);
            return socket.emit('game:error', errResponse);
          }

          const { pin, nickname } = parseResult.data;

          // Sanitization & Profanity Check: Validate appropriate school classroom nickname
          const nicknameCheck = isAppropriateNickname(nickname);
          if (!nicknameCheck.valid) {
            const errResponse = {
              success: false,
              code: 'INAPPROPRIATE_NICKNAME',
              message: nicknameCheck.reason || 'This nickname is not permitted in classroom sessions.'
            };
            if (ack) ack(errResponse);
            return socket.emit('game:error', errResponse);
          }

          const clientIp = socket.handshake.address || (socket.conn as any)?.remoteAddress || 'unknown';
          const rateLimitKey = `ws_pin:${clientIp}`;

          if (this.pinRateLimiter.isBlocked(rateLimitKey)) {
            const errResponse = {
              success: false,
              code: 'TOO_MANY_REQUESTS',
              message: 'Too many invalid PIN attempts. Please wait before trying again.'
            };
            if (ack) return ack(errResponse);
            return socket.emit('game:error', errResponse);
          }

          // Find game session
          const session = await this.db.findSessionByPin(pin);
          if (!session) {
            this.pinRateLimiter.check(rateLimitKey); // Record invalid PIN attempt
            const errResponse = { success: false, code: 'PIN_NOT_FOUND', message: 'Invalid Game PIN' };
            if (ack) return ack(errResponse);
            return socket.emit('game:error', errResponse);
          }

          // Successful PIN lookup resets previous failed attempts
          this.pinRateLimiter.reset(rateLimitKey);

          // Check game status
          if (session.status !== 'LOBBY') {
            const errResponse = {
              success: false,
              code: 'GAME_NOT_IN_LOBBY',
              message: `Cannot join game currently in ${session.status} state`
            };
            if (ack) return ack(errResponse);
            return socket.emit('game:error', errResponse);
          }

          // Check if nickname is already taken in this session
          const roomParticipants = await this.db.getSessionParticipants(session.id);
          const existingParticipant = roomParticipants.find(p => p.nickname.toLowerCase() === nickname.toLowerCase());
          if (existingParticipant) {
            const errResponse = {
              success: false,
              code: 'NICKNAME_TAKEN',
              message: 'This nickname is already taken in this room. Please choose another.'
            };
            if (ack) return ack(errResponse);
            return socket.emit('game:error', errResponse);
          }

          const participantId = crypto.randomUUID();
          try {
            await this.db.addParticipant({
              id: participantId,
              session_id: session.id,
              nickname,
              joined_at: Date.now()
            });
          } catch (dbErr: any) {
            if (dbErr.message && dbErr.message.includes('UNIQUE constraint failed')) {
              const errResponse = {
                success: false,
                code: 'NICKNAME_TAKEN',
                message: 'This nickname is already taken in this room. Please choose another.'
              };
              if (ack) return ack(errResponse);
              return socket.emit('game:error', errResponse);
            }
            throw dbErr;
          }

          // Store socket metadata
          socketData.participantId = participantId;
          socketData.sessionId = session.id;
          socketData.nickname = nickname;
          socketData.isTeacher = false;

          // Join session rooms
          socket.join(`session:${session.id}`);
          socket.join(`participant:${participantId}`);

          // Issue ephemeral participant token for answer authorization
          const participantToken = signAuthToken({
            userId: participantId,
            email: `guest_${participantId}@room`,
            role: UserRole.STUDENT,
            displayName: nickname
          });

          const successResponse = {
            success: true,
            participantId,
            sessionId: session.id,
            nickname,
            token: participantToken
          };

          if (ack) ack(successResponse);
          socket.emit('game:joined_success', successResponse);

          // Broadcast to teacher and room that a student joined (if newly added)
          if (!existingParticipant) {
            const updatedParticipants = await this.db.getSessionParticipants(session.id);
            this.io.to(`session:${session.id}`).emit('game:participant_joined', {
              participantId,
              nickname,
              totalParticipants: updatedParticipants.length
            });
          }

          // If game has already progressed to an active question, catch up the participant immediately!
          if (session.status === 'QUESTION_ACTIVE' && session.current_question_id) {
            const publicQuestion = await this.db.getPublicQuestionForStudent(session.current_question_id);
            if (publicQuestion) {
              const questions = await this.db.getQuestionsForQuiz(session.quiz_id);
              socket.emit('game:question_started', {
                questionIndex: session.current_question_index,
                totalQuestions: questions.length,
                questionId: publicQuestion.id,
                prompt: publicQuestion.prompt,
                timeLimitSec: publicQuestion.time_limit_sec,
                durationSec: publicQuestion.time_limit_sec,
                basePoints: publicQuestion.base_points,
                serverStartTime: session.question_start_time,
                serverDeadline: session.question_deadline,
                roundNonce: session.round_nonce,
                options: publicQuestion.options.map(opt => ({
                  id: opt.id,
                  order_index: opt.order_index,
                  option_text: opt.option_text,
                  optionText: opt.option_text
                }))
              });
            }
          }
        } catch (err: any) {
          const errResponse = { success: false, code: 'SERVER_ERROR', message: 'Failed to join game' };
          if (ack) ack(errResponse);
          socket.emit('game:error', errResponse);
        }
      });

      // 1.1 Participant Reconnect Handler
      socket.on('game:reconnect', async (payload: { sessionId: string; participantId: string }, ack?: (res: any) => void) => {
        try {
          if (!payload?.sessionId || !payload?.participantId) {
            const errResponse = { success: false, code: 'INVALID_PAYLOAD', message: 'Missing sessionId or participantId' };
            if (ack) return ack(errResponse);
            return socket.emit('game:error', errResponse);
          }

          const session = await this.db.findSessionById(payload.sessionId);
          if (!session || session.status === 'FINISHED') {
            const errResponse = { success: false, code: 'SESSION_NOT_FOUND', message: 'Session no longer active' };
            if (ack) return ack(errResponse);
            return socket.emit('game:error', errResponse);
          }

          const participants = await this.db.getSessionParticipants(session.id);
          const participant = participants.find(p => p.id === payload.participantId);
          if (!participant) {
            const errResponse = { success: false, code: 'PARTICIPANT_NOT_FOUND', message: 'Participant not found in session' };
            if (ack) return ack(errResponse);
            return socket.emit('game:error', errResponse);
          }

          socketData.participantId = participant.id;
          socketData.sessionId = session.id;
          socketData.nickname = participant.nickname;
          socketData.isTeacher = false;

          socket.join(`session:${session.id}`);
          socket.join(`participant:${participant.id}`);

          let currentQuestionPayload = null;
          if (session.status === 'QUESTION_ACTIVE' && session.current_question_id) {
            const publicQuestion = await this.db.getPublicQuestionForStudent(session.current_question_id);
            if (publicQuestion) {
              const questions = await this.db.getQuestionsForQuiz(session.quiz_id);
              currentQuestionPayload = {
                questionIndex: session.current_question_index,
                totalQuestions: questions.length,
                questionId: publicQuestion.id,
                prompt: publicQuestion.prompt,
                timeLimitSec: publicQuestion.time_limit_sec,
                durationSec: publicQuestion.time_limit_sec,
                basePoints: publicQuestion.base_points,
                serverStartTime: session.question_start_time,
                serverDeadline: session.question_deadline,
                roundNonce: session.round_nonce,
                options: publicQuestion.options.map(opt => ({
                  id: opt.id,
                  order_index: opt.order_index,
                  option_text: opt.option_text,
                  optionText: opt.option_text
                }))
              };
            }
          }

          const successResponse = {
            success: true,
            sessionId: session.id,
            status: session.status,
            participantId: participant.id,
            nickname: participant.nickname,
            currentQuestion: currentQuestionPayload
          };

          if (ack) ack(successResponse);
          socket.emit('game:reconnected_success', successResponse);

          if (currentQuestionPayload) {
            socket.emit('game:question_started', currentQuestionPayload);
          }
        } catch (err: any) {
          const errResponse = { success: false, code: 'SERVER_ERROR', message: 'Failed to reconnect' };
          if (ack) return ack(errResponse);
          socket.emit('game:error', errResponse);
        }
      });

      // 2. Teacher connects to manage the session room
      socket.on('game:teacher_join', async (payload: { sessionId: string; token: string }, ack?: (res: any) => void) => {
        try {
          if (!payload || !payload.sessionId || !payload.token) {
            const errResponse = { success: false, code: 'INVALID_PAYLOAD', message: 'Missing sessionId or token' };
            if (ack) return ack(errResponse);
            return socket.emit('game:error', errResponse);
          }

          // Check if token has been revoked
          if (defaultRevocationService.isRevoked(payload.token)) {
            const errResponse = { success: false, code: 'UNAUTHORIZED', message: 'Token has been revoked' };
            if (ack) return ack(errResponse);
            return socket.emit('game:error', errResponse);
          }

          const user = await verifyAnyToken(payload.token, this.db);
          if (!user || (user.role !== UserRole.TEACHER && user.role !== UserRole.ADMIN)) {
            const errResponse = { success: false, code: 'UNAUTHORIZED', message: 'Teacher authentication required' };
            if (ack) return ack(errResponse);
            return socket.emit('game:error', errResponse);
          }

          const session = await this.db.findSessionById(payload.sessionId);
          if (!session || session.host_teacher_id !== user.userId) {
            const errResponse = { success: false, code: 'FORBIDDEN', message: 'You are not the host of this session' };
            if (ack) return ack(errResponse);
            return socket.emit('game:error', errResponse);
          }

          socketData.userId = user.userId;
          socketData.sessionId = session.id;
          socketData.isTeacher = true;

          socket.join(`session:${session.id}`);
          socket.join(`teacher:${session.id}`);

          const participants = await this.db.getSessionParticipants(session.id);
          const successResponse = {
            success: true,
            sessionId: session.id,
            status: session.status,
            participants
          };

          if (ack) ack(successResponse);
          socket.emit('game:teacher_ready', successResponse);
        } catch (err) {
          const errResponse = { success: false, code: 'SERVER_ERROR', message: 'Teacher join failed' };
          if (ack) ack(errResponse);
          socket.emit('game:error', errResponse);
        }
      });

      // 3. Teacher kicks inappropriate participant
      socket.on('game:kick_participant', async (payload: unknown, ack?: (res: any) => void) => {
        try {
          if (!socketData.isTeacher || !socketData.sessionId) {
            const errResponse = { success: false, code: 'FORBIDDEN', message: 'Only host teacher can kick participants' };
            if (ack) return ack(errResponse);
            return socket.emit('game:error', errResponse);
          }

          const parseResult = KickParticipantSchema.safeParse(payload);
          if (!parseResult.success) {
            const errResponse = { success: false, code: 'INVALID_PAYLOAD', message: 'Invalid kick payload' };
            if (ack) return ack(errResponse);
            return socket.emit('game:error', errResponse);
          }

          const { participantId } = parseResult.data;

          // Remove participant from database so they are completely inactive
          await this.db.removeParticipant(participantId);

          // Notify participant that they have been kicked
          this.io.to(`participant:${participantId}`).emit('game:kicked', {
            message: 'You have been removed from this game session by the host.'
          });

          // Disconnect kicked socket from room
          const participantSockets = await this.io.in(`participant:${participantId}`).fetchSockets();
          for (const s of participantSockets) {
            (s as any).data = {};
            s.leave(`session:${socketData.sessionId}`);
            s.disconnect(true);
          }

          // Broadcast participant left to the room
          const remaining = await this.db.getSessionParticipants(socketData.sessionId);
          this.io.to(`session:${socketData.sessionId}`).emit('game:participant_left', {
            participantId,
            totalParticipants: remaining.length
          });

          if (ack) ack({ success: true, participantId });
        } catch (err) {
          const errResponse = { success: false, code: 'SERVER_ERROR', message: 'Kick operation failed' };
          if (ack) ack(errResponse);
          socket.emit('game:error', errResponse);
        }
      });

      // 4. Teacher starts the game (Transitions from LOBBY to Question 0)
      socket.on('game:start_game', async (payload: { sessionId: string; token?: string }, ack?: (res: any) => void) => {
        try {
          if (!socketData.isTeacher || !socketData.sessionId || socketData.sessionId !== payload?.sessionId) {
            // Re-authenticate teacher if socket reconnected and token was provided
            if (payload?.sessionId && payload?.token) {
              const user = verifyAuthToken(payload.token);
              if (user && (user.role === UserRole.TEACHER || user.role === UserRole.ADMIN)) {
                const session = await this.db.findSessionById(payload.sessionId);
                if (session && session.host_teacher_id === user.userId) {
                  socketData.userId = user.userId;
                  socketData.sessionId = session.id;
                  socketData.isTeacher = true;
                  socket.join(`session:${session.id}`);
                  socket.join(`teacher:${session.id}`);
                }
              }
            }
          }

          if (!socketData.isTeacher || !socketData.sessionId || socketData.sessionId !== payload?.sessionId) {
            const errResponse = { success: false, code: 'FORBIDDEN', message: 'Only host teacher can start the game' };
            if (ack) return ack(errResponse);
            return socket.emit('game:error', errResponse);
          }

          const session = await this.db.findSessionById(socketData.sessionId);
          if (!session || session.status !== 'LOBBY') {
            const errResponse = { success: false, code: 'INVALID_STATE', message: 'Game is not in LOBBY state' };
            if (ack) return ack(errResponse);
            return socket.emit('game:error', errResponse);
          }

          const dispatchResult = await this.gameEngine.dispatchQuestion(socketData.sessionId, 0);
          if (!dispatchResult.success) {
            const errResponse = { success: false, code: 'DISPATCH_ERROR', message: dispatchResult.message };
            if (ack) return ack(errResponse);
            return socket.emit('game:error', errResponse);
          }

          if (ack) ack({ success: true, questionIndex: 0 });
        } catch (err) {
          const errResponse = { success: false, code: 'SERVER_ERROR', message: 'Failed to start game' };
          if (ack) return ack(errResponse);
          socket.emit('game:error', errResponse);
        }
      });

      // 5. Teacher advances to next question
      socket.on('game:next_question', async (payload: { sessionId: string }, ack?: (res: any) => void) => {
        try {
          if (!socketData.isTeacher || !socketData.sessionId || socketData.sessionId !== payload?.sessionId) {
            const errResponse = { success: false, code: 'FORBIDDEN', message: 'Only host teacher can advance questions' };
            if (ack) return ack(errResponse);
            return socket.emit('game:error', errResponse);
          }

          const session = await this.db.findSessionById(socketData.sessionId);
          if (!session) {
            const errResponse = { success: false, code: 'NOT_FOUND', message: 'Session not found' };
            if (ack) return ack(errResponse);
            return socket.emit('game:error', errResponse);
          }

          const nextIndex = session.current_question_index + 1;
          const questions = await this.db.getQuestionsForQuiz(session.quiz_id);

          if (nextIndex >= questions.length) {
            // End of quiz
            await this.db.updateSessionState(socketData.sessionId, { status: 'FINISHED' });

            const { podium, participantRankMap } = await this.leaderboardEngine.getFinalPodium(socketData.sessionId);

            // 1. Broadcast top 3 podium to classroom screen
            this.io.to(`session:${socketData.sessionId}`).emit('game:final_podium', podium);

            // 2. Broadcast private personal result to each individual student socket
            for (const [pId, result] of participantRankMap.entries()) {
              this.io.to(`participant:${pId}`).emit('game:final_personal_result', {
                rank: result.rank,
                totalScore: result.totalScore,
                streak: result.streak,
                totalParticipants: podium.totalParticipants
              });
            }

            if (ack) ack({ success: true, finished: true, podium });
            return;
          }

          const dispatchResult = await this.gameEngine.dispatchQuestion(socketData.sessionId, nextIndex);
          if (!dispatchResult.success) {
            const errResponse = { success: false, code: 'DISPATCH_ERROR', message: dispatchResult.message };
            if (ack) return ack(errResponse);
            return socket.emit('game:error', errResponse);
          }

          if (ack) ack({ success: true, questionIndex: nextIndex });
        } catch (err) {
          const errResponse = { success: false, code: 'SERVER_ERROR', message: 'Failed to advance question' };
          if (ack) return ack(errResponse);
          socket.emit('game:error', errResponse);
        }
      });

      // 6. Teacher displays live intermediate leaderboard
      socket.on('game:show_leaderboard', async (payload: { sessionId: string }, ack?: (res: any) => void) => {
        try {
          if (!socketData.isTeacher || !socketData.sessionId || socketData.sessionId !== payload?.sessionId) {
            const errResponse = { success: false, code: 'FORBIDDEN', message: 'Only host teacher can show leaderboard' };
            if (ack) return ack(errResponse);
            return socket.emit('game:error', errResponse);
          }

          await this.db.updateSessionState(socketData.sessionId, { status: 'LEADERBOARD' });
          const leaderboard = await this.leaderboardEngine.getLeaderboard(socketData.sessionId, 5);

          this.io.to(`session:${socketData.sessionId}`).emit('game:leaderboard_update', {
            leaderboard
          });

          if (ack) ack({ success: true, leaderboard });
        } catch (err) {
          const errResponse = { success: false, code: 'SERVER_ERROR', message: 'Failed to show leaderboard' };
          if (ack) return ack(errResponse);
          socket.emit('game:error', errResponse);
        }
      });

      // 7. Student submits answer (Authoritative evaluation, scoring, and anti-replay)
      socket.on('game:submit_answer', async (payload: unknown, ack?: (res: any) => void) => {
        try {
          if (!socketData.participantId || !socketData.sessionId) {
            const errResponse = { success: false, code: 'UNAUTHORIZED', message: 'Must be an active participant in a game' };
            if (ack) return ack(errResponse);
            return socket.emit('game:error', errResponse);
          }

          const parseResult = SubmitAnswerSchema.safeParse(payload);
          if (!parseResult.success) {
            const errResponse = {
              success: false,
              code: 'INVALID_PAYLOAD',
              message: 'Invalid answer submission payload',
              errors: parseResult.error.flatten().fieldErrors
            };
            if (ack) return ack(errResponse);
            return socket.emit('game:error', errResponse);
          }

          const { sessionId, questionId, selectedOptionId, roundNonce } = parseResult.data;

          if (sessionId !== socketData.sessionId) {
            const errResponse = { success: false, code: 'SESSION_MISMATCH', message: 'Cannot submit answer to another session' };
            if (ack) return ack(errResponse);
            return socket.emit('game:error', errResponse);
          }

          // Evaluate answer via Authoritative Scoring Engine
          const evalResult = await this.scoringEngine.submitAnswer({
            sessionId,
            participantId: socketData.participantId,
            questionId,
            selectedOptionId,
            roundNonce,
            serverReceivedTime: Date.now()
          });

          if (!evalResult.success) {
            const errResponse = {
              success: false,
              code: evalResult.code || 'SUBMISSION_REJECTED',
              message: evalResult.message || 'Answer rejected'
            };
            if (ack) return ack(errResponse);
            return socket.emit('game:error', errResponse);
          }

          // Acknowledge receipt to the student
          const ackData = {
            success: true,
            questionId,
            responseTimeMs: evalResult.responseTimeMs,
            totalScore: evalResult.totalScore,
            streakCount: evalResult.streakCount
          };
          if (ack) ack(ackData);
          socket.emit('game:answer_acknowledged', ackData);

          // Broadcast updated answer count anonymously to the room
          const totalAnswers = await this.scoringEngine.countAnswersForQuestion(sessionId, questionId);
          const participants = await this.db.getSessionParticipants(sessionId);
          const totalParticipants = participants.length;

          this.io.to(`session:${sessionId}`).emit('game:answer_count_updated', {
            totalAnswers,
            totalParticipants
          });

          // Early transition if all active participants have submitted answers
          if (totalAnswers >= totalParticipants && totalParticipants > 0) {
            await this.gameEngine.handleQuestionTimerExpired(sessionId, questionId);
          }
        } catch (err) {
          const errResponse = { success: false, code: 'SERVER_ERROR', message: 'Failed to process answer' };
          if (ack) return ack(errResponse);
          socket.emit('game:error', errResponse);
        }
      });

      // 7. Handle Disconnect
      socket.on('disconnect', () => {
        if (socketData.participantId && socketData.sessionId) {
          this.io.to(`session:${socketData.sessionId}`).emit('game:participant_disconnected', {
            participantId: socketData.participantId,
            nickname: socketData.nickname
          });
        }
      });
    });
  }

  public getIO(): SocketIOServer {
    return this.io;
  }
}
