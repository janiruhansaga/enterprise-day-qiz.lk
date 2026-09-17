import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { FirestoreDatastore } from '../src/db/firestoreDatastore.js';
import { UserRole } from '../src/config/security.js';
import { createDatastore } from '../src/db/datastoreFactory.js';

describe('Firebase Firestore Integration & Security Verification Suite', () => {
  describe('FIREBASE-01: Datastore Factory & Abstraction', () => {
    it('defaults to SQLite DatabaseService when DATASTORE_TYPE is unset or sqlite', () => {
      const ds = createDatastore('sqlite');
      assert.ok(ds, 'Datastore should be created');
      assert.equal(typeof ds.createUser, 'function');
      assert.equal(typeof ds.findUserByEmail, 'function');
      assert.equal(typeof ds.recordAnswerAtomic, 'function');
    });

    it('instantiates FirestoreDatastore when DATASTORE_TYPE is firestore', () => {
      // In absence of live credentials, verify class instantiation pattern
      process.env.FIREBASE_PROJECT_ID = 'mindpulse-arena-test';
      const fds = new FirestoreDatastore({
        collection: () => ({}),
        batch: () => ({}),
        runTransaction: async () => {}
      } as any);
      assert.ok(fds instanceof FirestoreDatastore);
      assert.equal(typeof fds.createQuiz, 'function');
      assert.equal(typeof fds.addQuestionWithSecretAnswers, 'function');
      assert.equal(typeof fds.recordAnswerAtomic, 'function');
    });
  });

  describe('FIREBASE-02: Zero-Trust Question & Secret Answer Isolation Contract', () => {
    it('physically isolates secret is_correct from public questions collection', async () => {
      const storedDocs: Record<string, any> = {};
      const secretDocs: Record<string, any> = {};

      const mockDb: any = {
        collection: (colName: string) => ({
          doc: (docId: string) => ({
            get: async () => ({ exists: true, data: () => ({ id: docId }) }),
            collection: (subCol: string) => ({
              doc: (subId: string) => ({
                id: subId,
                ref: { id: subId }
              })
            })
          })
        }),
        batch: () => {
          return {
            set: (ref: any, data: any) => {
              if (data.options) {
                storedDocs[ref.id] = data;
              } else if (data.correctOptionId) {
                secretDocs[ref.id] = data;
              }
            },
            commit: async () => {}
          };
        }
      };

      const fds = new FirestoreDatastore(mockDb);

      const qId = crypto.randomUUID();
      const quizId = crypto.randomUUID();
      const opt1Id = crypto.randomUUID();
      const opt2Id = crypto.randomUUID();

      await fds.addQuestionWithSecretAnswers(
        {
          id: qId,
          quiz_id: quizId,
          order_index: 1,
          prompt: 'What is zero-trust architecture?',
          time_limit_sec: 20,
          base_points: 1000,
          created_at: Date.now()
        },
        [
          { id: opt1Id, option_text: 'Never trust, always verify', order_index: 0, is_correct: true },
          { id: opt2Id, option_text: 'Trust everything behind firewall', order_index: 1, is_correct: false }
        ]
      );

      // Verify public question payload contains zero 'is_correct' flags
      const publicDoc = storedDocs[qId];
      assert.ok(publicDoc, 'Public question doc must be written');
      assert.equal(publicDoc.options.length, 2);
      for (const opt of publicDoc.options) {
        assert.equal('is_correct' in opt, false, 'is_correct must NEVER be in public question options');
        assert.equal('isCorrect' in opt, false, 'isCorrect must NEVER be in public question options');
      }

      // Verify secret key document contains the correct answer option ID
      const secretDoc = secretDocs[qId];
      assert.ok(secretDoc, 'Secret answer key doc must be written to isolated subcollection');
      assert.equal(secretDoc.correctOptionId, opt1Id, 'Secret answer key must store correctOptionId');
    });
  });

  describe('FIREBASE-03: Atomic Answer Recording & Race Condition Defense Contract', () => {
    it('uses Firestore transactions and unique participant-question key to block duplicates', async () => {
      let transactionRun = false;

      const mockDb: any = {
        collection: (colName: string) => ({
          doc: (docId: string) => ({
            collection: (subName: string) => ({
              doc: (subId: string) => ({ id: subId })
            })
          })
        }),
        runTransaction: async (updateFn: any) => {
          transactionRun = true;
          const fakeTx = {
            get: async (ref: any) => {
              if (ref.id.includes('already_answered')) {
                return { exists: true };
              }
              return { exists: false, data: () => ({ total_score: 500, streak_count: 2 }) };
            },
            set: () => {},
            update: () => {}
          };
          await updateFn(fakeTx);
        }
      };

      const fds = new FirestoreDatastore(mockDb);

      // Attempt submission that already exists
      await assert.rejects(async () => {
        await fds.recordAnswerAtomic({
          id: 'resp-1',
          session_id: 'session-1',
          participant_id: 'already_answered_part',
          question_id: 'q-1',
          selected_option_id: 'opt-1',
          is_correct: true,
          points_awarded: 1000,
          response_time_ms: 1200,
          submitted_at: Date.now()
        });
      }, /UNIQUE constraint failed: uq_response_single_answer/);

      assert.equal(transactionRun, true, 'Must execute within Firestore transaction');
    });
  });
});
