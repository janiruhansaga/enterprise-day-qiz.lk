import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { DatabaseService } from '../src/db/database.js';
import { securityConfig, UserRole } from '../src/config/security.js';
import { setCustomFirebaseAuth } from '../src/config/firebase.js';

describe('Firebase Authentication & Zero-Trust Teacher Verification Suite', () => {
  let app: ReturnType<typeof buildApp>;
  let db: DatabaseService;

  // Track mock calls to setCustomUserClaims
  const claimsAssigned: Record<string, any> = {};

  // Mock Firebase Auth instance
  const mockFirebaseAuth: any = {
    verifyIdToken: async (token: string) => {
      if (token === 'returning-teacher-token') {
        return {
          uid: 'fb-teacher-returning-uid',
          email: 'prof.returning@enterprise.edu',
          name: 'Professor Returning',
          role: 'teacher'
        };
      }
      if (token === 'first-time-teacher-token') {
        return {
          uid: 'fb-teacher-first-time-uid',
          email: 'new.teacher@enterprise.edu',
          name: 'New Teacher Alice'
        };
      }
      if (token === 'unauthorized-google-user-token') {
        return {
          uid: 'fb-regular-google-user-uid',
          email: 'random.person@gmail.com',
          name: 'Random Google User'
        };
      }
      throw new Error('Firebase ID token has expired or is invalid');
    },
    setCustomUserClaims: async (uid: string, claims: any) => {
      claimsAssigned[uid] = claims;
    }
  };

  before(async () => {
    setCustomFirebaseAuth(mockFirebaseAuth);
    db = new DatabaseService(':memory:');
    app = buildApp(db);
    await app.ready();
  });

  after(async () => {
    setCustomFirebaseAuth(null);
    await app.close();
    db.close();
  });

  // Requirement 1: First-time Google authentication without teacher code -> teacher access denied / code required
  it('TEST-1: first-time Google authentication without teacher code -> code required (403)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/firebase-login',
      payload: {
        idToken: 'first-time-teacher-token'
      }
    });

    assert.equal(res.statusCode, 403);
    const body = JSON.parse(res.body);
    assert.equal(body.code, 'TEACHER_REGISTRATION_CODE_REQUIRED');
    assert.match(body.message, /Teacher authorization required/i);
  });

  // Requirement 2: First-time Google authentication with invalid code -> denied
  it('TEST-2: first-time Google authentication with invalid code -> denied (403)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/firebase-register',
      payload: {
        idToken: 'first-time-teacher-token',
        invitationCode: 'invalid_code_guess'
      }
    });

    assert.equal(res.statusCode, 403);
    const body = JSON.parse(res.body);
    assert.match(body.message, /invalid or missing teacher registration code/i);

    // Verify user was NOT created
    const userInDb = await db.findUserById('fb-teacher-first-time-uid');
    assert.equal(userInDb, null, 'User must not be created when registration code is invalid');
  });

  // Requirement 3: First-time Google authentication with valid code -> TEACHER created
  it('TEST-3: first-time Google authentication with valid code -> TEACHER created (201)', async () => {
    const validSecret = securityConfig.teacherRegistrationSecret;
    assert.ok(validSecret, 'Teacher registration secret must exist in config');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/firebase-register',
      payload: {
        idToken: 'first-time-teacher-token',
        displayName: 'Teacher Alice',
        invitationCode: validSecret
      }
    });

    assert.equal(res.statusCode, 201);
    const body = JSON.parse(res.body);
    assert.equal(body.user.role, UserRole.TEACHER);
    assert.equal(body.user.id, 'fb-teacher-first-time-uid');

    // Verify persisted in datastore
    const userInDb = await db.findUserById('fb-teacher-first-time-uid');
    assert.ok(userInDb);
    assert.equal(userInDb.role, UserRole.TEACHER);
    assert.equal(userInDb.email, 'new.teacher@enterprise.edu');
  });

  // Requirement 4: Returning authorized teacher Google login -> access granted without code
  it('TEST-4: returning authorized teacher Google login -> access granted without code (200)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/firebase-login',
      payload: {
        idToken: 'first-time-teacher-token'
      }
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.user.role, UserRole.TEACHER);
    assert.equal(body.user.id, 'fb-teacher-first-time-uid');
    assert.ok(body.token);

    // Cookie must be set
    const cookies = res.headers['set-cookie'];
    assert.ok(cookies);
    assert.match(String(cookies), /HttpOnly/i);
  });

  // Requirement 5: Normal Google-authenticated user without teacher authorization -> NOT TEACHER
  it('TEST-5: normal Google user without teacher authorization -> NOT TEACHER (denied)', async () => {
    // Attempting login fails
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/firebase-login',
      payload: {
        idToken: 'unauthorized-google-user-token'
      }
    });
    assert.equal(loginRes.statusCode, 403);

    // Attempting to call protected teacher API directly with unverified token fails (401 / null role)
    const apiRes = await app.inject({
      method: 'GET',
      url: '/api/v1/quizzes',
      headers: {
        authorization: 'Bearer unauthorized-google-user-token'
      }
    });
    assert.equal(apiRes.statusCode, 401);

    // Datastore does not have this user as teacher
    const dbRecord = await db.findUserById('fb-regular-google-user-uid');
    assert.equal(dbRecord, null);
  });

  // Requirement 6: Student Game PIN join -> works without Firebase Authentication
  it('TEST-6: student Game PIN join -> works without Firebase Authentication', async () => {
    // 1. Teacher creates a quiz
    const quizRes = await app.inject({
      method: 'POST',
      url: '/api/v1/quizzes',
      headers: {
        authorization: 'Bearer first-time-teacher-token'
      },
      payload: {
        title: 'Enterprise Arena Quiz',
        description: 'Testing student PIN join'
      }
    });
    assert.equal(quizRes.statusCode, 201);
    const quizData = JSON.parse(quizRes.body);
    const quizId = quizData.quiz.id;

    // 2. Teacher adds a question
    const questionRes = await app.inject({
      method: 'POST',
      url: `/api/v1/quizzes/${quizId}/questions`,
      headers: {
        authorization: 'Bearer first-time-teacher-token'
      },
      payload: {
        prompt: 'What is 2 + 2?',
        timeLimitSec: 15,
        basePoints: 1000,
        options: [
          { optionText: '3', isCorrect: false },
          { optionText: '4', isCorrect: true }
        ]
      }
    });
    assert.equal(questionRes.statusCode, 201);

    // 3. Teacher hosts a session
    const sessionRes = await app.inject({
      method: 'POST',
      url: '/api/v1/games',
      headers: {
        authorization: 'Bearer first-time-teacher-token'
      },
      payload: {
        quizId
      }
    });
    assert.equal(sessionRes.statusCode, 201);
    const sessionData = JSON.parse(sessionRes.body);
    const pin = sessionData.session?.pin;
    assert.ok(pin, 'Session must generate a PIN');

    // 4. Student looks up PIN WITHOUT ANY AUTHENTICATION OR FIREBASE TOKEN
    const lookupRes = await app.inject({
      method: 'GET',
      url: `/api/v1/games/pin/${pin}`
    });
    assert.equal(lookupRes.statusCode, 200);
    const lookupBody = JSON.parse(lookupRes.body);
    assert.equal(lookupBody.valid, true);
    assert.equal(lookupBody.status, 'LOBBY');
    assert.equal(lookupBody.sessionId, sessionData.session?.id);
  });

  // Requirement 7: Student cannot access teacher API
  it('TEST-7: student cannot access teacher API (403 Forbidden)', async () => {
    // Register a student via standard local registration
    const studentRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'student.bob@school.edu',
        password: 'Password123!',
        displayName: 'StudentBob'
      }
    });
    assert.equal(studentRes.statusCode, 201);
    const studentToken = JSON.parse(studentRes.body).token;

    // Student attempts to fetch teacher quizzes
    const quizListRes = await app.inject({
      method: 'GET',
      url: '/api/v1/quizzes',
      headers: {
        authorization: `Bearer ${studentToken}`
      }
    });
    assert.equal(quizListRes.statusCode, 403);
    assert.match(quizListRes.body, /Access denied/i);
  });

  // Requirement 8: Client cannot self-assign TEACHER
  it('TEST-8: client cannot self-assign TEACHER role without server validation', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'attacker@school.edu',
        password: 'Password123!',
        displayName: 'Attacker',
        requestedRole: UserRole.TEACHER
        // No invitationCode
      }
    });
    assert.equal(res.statusCode, 403);
    assert.match(res.body, /authorization code/i);
  });

  // Requirement 9: Client cannot self-assign ADMIN
  it('TEST-9: client cannot self-assign ADMIN role', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'fakeadmin@school.edu',
        password: 'Password123!',
        displayName: 'FakeAdmin',
        requestedRole: UserRole.ADMIN,
        invitationCode: 'guess_secret'
      }
    });
    assert.equal(res.statusCode, 403);
  });

  // Requirement 10: Firebase UID is the teacher identity
  it('TEST-10: Firebase UID is strictly used as the teacher identity in datastore', async () => {
    const teacher = await db.findUserById('fb-teacher-first-time-uid');
    assert.ok(teacher);
    assert.equal(teacher.id, 'fb-teacher-first-time-uid');
  });

  // Requirement 11: Firebase custom claim is correctly assigned server-side
  it('TEST-11: Firebase custom claim { role: "teacher" } is correctly assigned server-side', async () => {
    assert.deepEqual(claimsAssigned['fb-teacher-first-time-uid'], { role: 'teacher' });
  });
});
