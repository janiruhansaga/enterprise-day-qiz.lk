import path from 'node:path';
import fs from 'node:fs';
import { DatabaseService } from '../db/database.js';
import { FirestoreDatastore } from '../db/firestoreDatastore.js';
import { getFirestoreDb } from '../config/firebase.js';

/**
 * EXPLICIT ONE-WAY MIGRATION SCRIPT: SQLite -> Firestore
 * Run manually via: npm run migrate:firestore
 *
 * CRITICAL SAFETY:
 * - Does NOT run automatically on server boot.
 * - Does NOT delete source SQLite data.
 * - Migrates records idempotently using document IDs.
 */
export async function migrateSqliteToFirestore(sqlitePath?: string) {
  const dbFile = sqlitePath || process.env.DB_PATH || path.resolve(process.cwd(), 'data', 'enterprise_quiz.sqlite');

  console.log(`[MIGRATION] Checking source SQLite database at: ${dbFile}`);
  if (!fs.existsSync(dbFile)) {
    console.error(`[MIGRATION] SQLite database file not found at ${dbFile}. Aborting.`);
    return;
  }

  const sqliteDb = new DatabaseService(dbFile);
  const firestore = getFirestoreDb();
  const firestoreDatastore = new FirestoreDatastore(firestore);

  console.log('[MIGRATION] Initializing migration to Cloud Firestore...');

  let userCount = 0;
  let quizCount = 0;
  let questionCount = 0;
  let sessionCount = 0;
  let participantCount = 0;
  let responseCount = 0;

  // 1. Migrate Users
  const users = (sqliteDb as any).db.prepare('SELECT * FROM users').all() as any[];
  console.log(`[MIGRATION] Found ${users.length} users in SQLite.`);
  for (const u of users) {
    const existing = await firestoreDatastore.findUserById(u.id);
    if (!existing) {
      await firestore.collection('users').doc(u.id).set({
        id: u.id,
        email: u.email.toLowerCase(),
        password_hash: u.password_hash,
        role: u.role,
        display_name: u.display_name,
        created_at: u.created_at
      });
      userCount++;
    }
  }

  // 2. Migrate Quizzes, Questions & Secret Answer Keys
  const quizzes = (sqliteDb as any).db.prepare('SELECT * FROM quizzes').all() as any[];
  console.log(`[MIGRATION] Found ${quizzes.length} quizzes in SQLite.`);
  for (const q of quizzes) {
    await firestore.collection('quizzes').doc(q.id).set({
      id: q.id,
      teacher_id: q.teacher_id,
      title: q.title,
      description: q.description || '',
      is_published: q.is_published ? 1 : 0,
      created_at: q.created_at,
      updated_at: q.updated_at
    });
    quizCount++;

    // Migrate questions for this quiz
    const questions = (sqliteDb as any).db.prepare('SELECT * FROM questions WHERE quiz_id = ? ORDER BY order_index ASC').all(q.id) as any[];
    for (const qst of questions) {
      const options = (sqliteDb as any).db.prepare('SELECT * FROM answer_options WHERE question_id = ? ORDER BY order_index ASC').all(qst.id) as any[];
      const correctOpt = options.find((o: any) => o.is_correct === 1);

      // Public question doc
      const cleanOptions = options.map((o: any) => ({
        id: o.id,
        option_text: o.option_text,
        order_index: o.order_index
      }));

      await firestore.collection('quizzes').doc(q.id).collection('questions').doc(qst.id).set({
        id: qst.id,
        quiz_id: qst.quiz_id,
        order_index: qst.order_index,
        prompt: qst.prompt,
        time_limit_sec: qst.time_limit_sec,
        base_points: qst.base_points,
        created_at: qst.created_at,
        options: cleanOptions
      });

      // Secret answer key subcollection
      if (correctOpt) {
        await firestore.collection('quizzes').doc(q.id).collection('secret_keys').doc(qst.id).set({
          questionId: qst.id,
          quiz_id: q.id,
          correctOptionId: correctOpt.id,
          time_limit_sec: qst.time_limit_sec,
          base_points: qst.base_points
        });
      }
      questionCount++;
    }
  }

  // 3. Migrate Game Sessions, Participants & Responses
  const sessions = (sqliteDb as any).db.prepare('SELECT * FROM game_sessions').all() as any[];
  console.log(`[MIGRATION] Found ${sessions.length} game sessions in SQLite.`);
  for (const s of sessions) {
    await firestore.collection('game_sessions').doc(s.id).set({
      id: s.id,
      pin: s.pin,
      quiz_id: s.quiz_id,
      host_teacher_id: s.host_teacher_id,
      status: s.status,
      current_question_index: s.current_question_index || 0,
      current_question_id: s.current_question_id || null,
      question_start_time: s.question_start_time || null,
      question_deadline: s.question_deadline || null,
      round_nonce: s.round_nonce || null,
      created_at: s.created_at
    });
    sessionCount++;

    // Participants
    const participants = (sqliteDb as any).db.prepare('SELECT * FROM participants WHERE session_id = ?').all(s.id) as any[];
    for (const p of participants) {
      await firestore.collection('game_sessions').doc(s.id).collection('participants').doc(p.id).set({
        id: p.id,
        session_id: p.session_id,
        user_id: p.user_id || null,
        nickname: p.nickname,
        total_score: p.total_score || 0,
        streak_count: p.streak_count || 0,
        is_connected: p.is_connected !== undefined ? p.is_connected : 1,
        joined_at: p.joined_at
      });
      participantCount++;
    }

    // Responses
    const responses = (sqliteDb as any).db.prepare('SELECT * FROM game_responses WHERE session_id = ?').all(s.id) as any[];
    for (const r of responses) {
      await firestore.collection('game_sessions').doc(s.id).collection('responses').doc(`${r.participant_id}_${r.question_id}`).set({
        id: r.id,
        session_id: r.session_id,
        participant_id: r.participant_id,
        question_id: r.question_id,
        selected_option_id: r.selected_option_id,
        is_correct: r.is_correct,
        points_awarded: r.points_awarded,
        response_time_ms: r.response_time_ms,
        submitted_at: r.submitted_at
      });
      responseCount++;
    }
  }

  console.log('====================================================');
  console.log('SQLITE TO FIRESTORE MIGRATION COMPLETE SUMMARY:');
  console.log(`- Users Migrated:         ${userCount}`);
  console.log(`- Quizzes Migrated:       ${quizCount}`);
  console.log(`- Questions Migrated:     ${questionCount}`);
  console.log(`- Game Sessions Migrated: ${sessionCount}`);
  console.log(`- Participants Migrated:  ${participantCount}`);
  console.log(`- Responses Migrated:     ${responseCount}`);
  console.log('====================================================');
}

// Allow standalone CLI execution: node/tsx src/scripts/migrateSqliteToFirestore.ts
if (process.argv[1] && process.argv[1].endsWith('migrateSqliteToFirestore.ts')) {
  migrateSqliteToFirestore().catch(err => {
    console.error('[MIGRATION ERROR]', err);
    process.exit(1);
  });
}
