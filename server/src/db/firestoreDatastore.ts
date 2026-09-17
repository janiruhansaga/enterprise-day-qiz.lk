import { Firestore, Transaction } from 'firebase-admin/firestore';
import { getFirestoreDb } from '../config/firebase.js';
import {
  IDatastore,
  UserRecord,
  QuizRecord,
  QuizUpdatePayload,
  QuestionRecord,
  OptionRecord,
  PublicQuestion,
  SecretAnswerKey,
  GameSessionRecord,
  SessionUpdatePayload,
  ParticipantRecord,
  GameResponseRecord
} from './datastore.interface.js';

export class FirestoreDatastore implements IDatastore {
  private db: Firestore;

  constructor(customDb?: Firestore) {
    this.db = customDb || getFirestoreDb();
  }

  // --- USER REPOSITORY ---
  public async createUser(user: UserRecord): Promise<void> {
    const existing = await this.findUserByEmail(user.email);
    if (existing) {
      throw new Error(`UNIQUE constraint failed: users.email (${user.email})`);
    }
    await this.db.collection('users').doc(user.id).set({
      id: user.id,
      uid: user.id,
      email: user.email.toLowerCase(),
      password_hash: user.password_hash,
      role: user.role,
      display_name: user.display_name,
      created_at: user.created_at,
      updated_at: Date.now()
    });
  }

  public async upsertTeacherUser(user: UserRecord): Promise<void> {
    await this.db.collection('users').doc(user.id).set({
      id: user.id,
      uid: user.id,
      email: user.email.toLowerCase(),
      password_hash: user.password_hash,
      role: user.role,
      display_name: user.display_name,
      created_at: user.created_at,
      updated_at: Date.now()
    }, { merge: true });
  }

  public async findUserByEmail(email: string): Promise<UserRecord | null> {
    const snap = await this.db
      .collection('users')
      .where('email', '==', email.toLowerCase())
      .limit(1)
      .get();
    if (snap.empty) return null;
    return snap.docs[0].data() as UserRecord;
  }

  public async findUserById(id: string): Promise<UserRecord | null> {
    const snap = await this.db.collection('users').doc(id).get();
    if (!snap.exists) return null;
    return snap.data() as UserRecord;
  }

  // --- QUIZ & QUESTION REPOSITORY ---
  public async createQuiz(quiz: QuizRecord): Promise<void> {
    // Foreign key check: verify teacher exists
    const teacher = await this.findUserById(quiz.teacher_id);
    if (!teacher) {
      throw new Error('FOREIGN KEY constraint failed: teacher_id does not exist');
    }

    await this.db.collection('quizzes').doc(quiz.id).set({
      id: quiz.id,
      teacher_id: quiz.teacher_id,
      title: quiz.title,
      description: quiz.description || '',
      is_published: quiz.is_published ? 1 : 0,
      created_at: quiz.created_at,
      updated_at: quiz.updated_at
    });
  }

  public async getQuizById(quizId: string): Promise<any | null> {
    const snap = await this.db.collection('quizzes').doc(quizId).get();
    if (!snap.exists) return null;
    return snap.data();
  }

  public async getQuizzesByTeacher(teacherId: string): Promise<any[]> {
    const snap = await this.db
      .collection('quizzes')
      .where('teacher_id', '==', teacherId)
      .get();

    const quizzes: any[] = [];
    for (const doc of snap.docs) {
      const data = doc.data();
      const questionsSnap = await doc.ref.collection('questions').get();
      quizzes.push({
        ...data,
        is_published: Boolean(data.is_published),
        question_count: questionsSnap.size
      });
    }

    // Sort descending by created_at
    quizzes.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    return quizzes;
  }

  public async getQuizWithDetailsForTeacher(quizId: string, teacherId: string): Promise<any | null> {
    const quizSnap = await this.db.collection('quizzes').doc(quizId).get();
    if (!quizSnap.exists) return null;
    const quiz = quizSnap.data()!;
    if (quiz.teacher_id !== teacherId) return null;

    const questionsSnap = await quizSnap.ref
      .collection('questions')
      .orderBy('order_index', 'asc')
      .get();

    const questions: any[] = [];
    for (const qDoc of questionsSnap.docs) {
      const qData = qDoc.data();
      const secretKeyDoc = await quizSnap.ref.collection('secret_keys').doc(qDoc.id).get();
      const secretKey = secretKeyDoc.exists ? secretKeyDoc.data() : null;
      const correctOptionId = secretKey?.correctOptionId;

      const options = (qData.options || []).map((opt: any) => ({
        ...opt,
        is_correct: opt.id === correctOptionId
      }));

      questions.push({
        id: qDoc.id,
        order_index: qData.order_index,
        prompt: qData.prompt,
        time_limit_sec: qData.time_limit_sec,
        base_points: qData.base_points,
        options
      });
    }

    return {
      ...quiz,
      is_published: Boolean(quiz.is_published),
      questions
    };
  }

  public async updateQuiz(quizId: string, teacherId: string, updates: QuizUpdatePayload): Promise<boolean> {
    const quizSnap = await this.db.collection('quizzes').doc(quizId).get();
    if (!quizSnap.exists) return false;
    const quiz = quizSnap.data()!;
    if (quiz.teacher_id !== teacherId) return false;

    const firestoreUpdates: Record<string, any> = {
      updated_at: Date.now()
    };
    if (updates.title !== undefined) firestoreUpdates.title = updates.title;
    if (updates.description !== undefined) firestoreUpdates.description = updates.description;
    if (updates.is_published !== undefined) firestoreUpdates.is_published = updates.is_published ? 1 : 0;

    await quizSnap.ref.update(firestoreUpdates);
    return true;
  }

  public async getNextQuestionOrder(quizId: string): Promise<number> {
    const snap = await this.db
      .collection('quizzes')
      .doc(quizId)
      .collection('questions')
      .orderBy('order_index', 'desc')
      .limit(1)
      .get();
    if (snap.empty) return 1;
    const top = snap.docs[0].data();
    return (top.order_index || 0) + 1;
  }

  public async deleteQuiz(quizId: string, teacherId: string): Promise<boolean> {
    const quizSnap = await this.db.collection('quizzes').doc(quizId).get();
    if (!quizSnap.exists) return false;
    const quiz = quizSnap.data()!;
    if (quiz.teacher_id !== teacherId) return false;

    // Delete questions and secret_keys subcollections in batch
    const batch = this.db.batch();
    const questionsSnap = await quizSnap.ref.collection('questions').get();
    for (const q of questionsSnap.docs) {
      batch.delete(q.ref);
    }
    const secretsSnap = await quizSnap.ref.collection('secret_keys').get();
    for (const s of secretsSnap.docs) {
      batch.delete(s.ref);
    }
    batch.delete(quizSnap.ref);
    await batch.commit();

    return true;
  }

  /**
   * CRITICAL SECURITY ISOLATION:
   * Public question data stored in /quizzes/{id}/questions/{qId} (NO is_correct fields).
   * Secret answer key stored in /quizzes/{id}/secret_keys/{qId} (Restricted internal access).
   */
  public async addQuestionWithSecretAnswers(question: QuestionRecord, options: OptionRecord[]): Promise<void> {
    const quizRef = this.db.collection('quizzes').doc(question.quiz_id);
    const quizDoc = await quizRef.get();
    if (!quizDoc.exists) {
      throw new Error('FOREIGN KEY constraint failed: quiz_id does not exist');
    }

    const correctOption = options.find(o => o.is_correct);
    if (!correctOption) {
      throw new Error('A question must have at least one correct option');
    }

    const batch = this.db.batch();

    // 1. Sanitized public question (Zero is_correct flags)
    const publicOptions = options.map(o => ({
      id: o.id,
      option_text: o.option_text,
      order_index: o.order_index
    }));

    const qRef = quizRef.collection('questions').doc(question.id);
    batch.set(qRef, {
      id: question.id,
      quiz_id: question.quiz_id,
      order_index: question.order_index,
      prompt: question.prompt,
      time_limit_sec: question.time_limit_sec,
      base_points: question.base_points,
      created_at: question.created_at,
      options: publicOptions
    });

    // 2. Secret answer key isolated in secret_keys subcollection
    const secretRef = quizRef.collection('secret_keys').doc(question.id);
    batch.set(secretRef, {
      questionId: question.id,
      quiz_id: question.quiz_id,
      correctOptionId: correctOption.id,
      time_limit_sec: question.time_limit_sec,
      base_points: question.base_points
    });

    await batch.commit();
  }

  public async getPublicQuestionForStudent(questionId: string): Promise<PublicQuestion | null> {
    const snap = await this.db
      .collectionGroup('questions')
      .where('id', '==', questionId)
      .limit(1)
      .get();
    if (snap.empty) return null;
    const data = snap.docs[0].data();

    // Guarantee options never contain is_correct
    const cleanOptions = (data.options || []).map((o: any) => ({
      id: o.id,
      option_text: o.option_text,
      order_index: o.order_index
    }));

    return {
      id: data.id,
      prompt: data.prompt,
      order_index: data.order_index,
      time_limit_sec: data.time_limit_sec,
      base_points: data.base_points,
      options: cleanOptions
    };
  }

  public async getSecretAnswerKey(questionId: string): Promise<SecretAnswerKey | null> {
    const snap = await this.db
      .collectionGroup('secret_keys')
      .where('questionId', '==', questionId)
      .limit(1)
      .get();
    if (snap.empty) return null;
    const data = snap.docs[0].data();
    return {
      correctOptionId: data.correctOptionId,
      time_limit_sec: data.time_limit_sec,
      base_points: data.base_points
    };
  }

  public async getQuestionsForQuiz(quizId: string): Promise<any[]> {
    const snap = await this.db
      .collection('quizzes')
      .doc(quizId)
      .collection('questions')
      .orderBy('order_index', 'asc')
      .get();
    return snap.docs.map((d: any) => d.data());
  }

  // --- GAME SESSION & PARTICIPANT REPOSITORY ---
  public async createGameSession(session: GameSessionRecord): Promise<void> {
    await this.db.collection('game_sessions').doc(session.id).set({
      id: session.id,
      pin: session.pin,
      quiz_id: session.quiz_id,
      host_teacher_id: session.host_teacher_id,
      status: 'LOBBY',
      current_question_index: 0,
      current_question_id: null,
      question_start_time: null,
      question_deadline: null,
      round_nonce: null,
      created_at: session.created_at
    });
  }

  public async findSessionByPin(pin: string): Promise<any | null> {
    const snap = await this.db
      .collection('game_sessions')
      .where('pin', '==', pin)
      .limit(1)
      .get();
    if (snap.empty) return null;
    return snap.docs[0].data();
  }

  public async findSessionById(sessionId: string): Promise<any | null> {
    const snap = await this.db.collection('game_sessions').doc(sessionId).get();
    if (!snap.exists) return null;
    return snap.data();
  }

  public async updateSessionState(sessionId: string, updates: SessionUpdatePayload): Promise<void> {
    await this.db.collection('game_sessions').doc(sessionId).update(updates);
  }

  public async addParticipant(participant: ParticipantRecord): Promise<void> {
    const sessionRef = this.db.collection('game_sessions').doc(participant.session_id);

    // Enforce unique nickname per room
    const existingNicknameSnap = await sessionRef
      .collection('participants')
      .where('nickname', '==', participant.nickname)
      .limit(1)
      .get();

    if (!existingNicknameSnap.empty) {
      throw new Error(`UNIQUE constraint failed: session_id, nickname (${participant.nickname})`);
    }

    await sessionRef.collection('participants').doc(participant.id).set({
      id: participant.id,
      session_id: participant.session_id,
      user_id: participant.user_id || null,
      nickname: participant.nickname,
      total_score: 0,
      streak_count: 0,
      is_connected: 1,
      joined_at: participant.joined_at
    });
  }

  public async getParticipant(participantId: string): Promise<any | null> {
    const snap = await this.db
      .collectionGroup('participants')
      .where('id', '==', participantId)
      .limit(1)
      .get();
    if (snap.empty) return null;
    return snap.docs[0].data();
  }

  public async removeParticipant(participantId: string): Promise<void> {
    const snap = await this.db
      .collectionGroup('participants')
      .where('id', '==', participantId)
      .limit(1)
      .get();
    if (!snap.empty) {
      await snap.docs[0].ref.delete();
    }
  }

  public async getSessionParticipants(sessionId: string): Promise<any[]> {
    const snap = await this.db
      .collection('game_sessions')
      .doc(sessionId)
      .collection('participants')
      .orderBy('total_score', 'desc')
      .get();
    return snap.docs.map((d: any) => d.data());
  }

  // --- ATOMIC ANSWER SUBMISSION & SCORE CALCULATION ---
  /**
   * ATOMIC ANSWER RECORDING WITH TRANSACTIONAL LOCK:
   * Uses Firestore Transactions with document ID `${participantId}_${questionId}`
   * to guarantee that at most 1 answer can ever be committed per participant per question.
   */
  public async recordAnswerAtomic(response: GameResponseRecord): Promise<void> {
    const sessionRef = this.db.collection('game_sessions').doc(response.session_id);
    const responseRef = sessionRef.collection('responses').doc(`${response.participant_id}_${response.question_id}`);
    const participantRef = sessionRef.collection('participants').doc(response.participant_id);

    await this.db.runTransaction(async (transaction: Transaction) => {
      // 1. Idempotency & duplicate submission check
      const existingResp = await transaction.get(responseRef);
      if (existingResp.exists) {
        throw new Error('UNIQUE constraint failed: uq_response_single_answer');
      }

      // 2. Fetch participant
      const partDoc = await transaction.get(participantRef);
      if (!partDoc.exists) {
        throw new Error('Participant does not exist in session');
      }
      const participant = partDoc.data()!;

      // 3. Write response
      transaction.set(responseRef, {
        id: response.id,
        session_id: response.session_id,
        participant_id: response.participant_id,
        question_id: response.question_id,
        selected_option_id: response.selected_option_id,
        is_correct: response.is_correct ? 1 : 0,
        points_awarded: response.points_awarded,
        response_time_ms: response.response_time_ms,
        submitted_at: response.submitted_at
      });

      // 4. Atomically update score and streak
      if (response.is_correct) {
        transaction.update(participantRef, {
          total_score: (participant.total_score || 0) + response.points_awarded,
          streak_count: (participant.streak_count || 0) + 1
        });
      } else {
        transaction.update(participantRef, {
          streak_count: 0
        });
      }
    });
  }

  public async hasParticipantAnswered(sessionId: string, participantId: string, questionId: string): Promise<boolean> {
    const snap = await this.db
      .collection('game_sessions')
      .doc(sessionId)
      .collection('responses')
      .doc(`${participantId}_${questionId}`)
      .get();
    return snap.exists;
  }

  public async countQuestionResponses(sessionId: string, questionId: string): Promise<number> {
    const snap = await this.db
      .collection('game_sessions')
      .doc(sessionId)
      .collection('responses')
      .where('question_id', '==', questionId)
      .count()
      .get();
    return snap.data().count;
  }

  public async close(): Promise<void> {
    // Firestore Admin manages connection pooling automatically
  }
}
