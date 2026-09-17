import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { buildApp } from '../src/app.js';
import { DatabaseService } from '../src/db/database.js';
import { securityConfig, UserRole } from '../src/config/security.js';

describe('Phase 2: Authentication & RBAC Security Suite', () => {
  let app: ReturnType<typeof buildApp>;
  let db: DatabaseService;

  before(async () => {
    // In-memory isolated database for tests
    db = new DatabaseService(':memory:');
    app = buildApp(db);
    await app.ready();
  });

  after(async () => {
    await app.close();
    db.close();
  });

  describe('User Registration Security', () => {
    it('allows legitimate student registration and sets HttpOnly cookie', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email: 'student1@school.edu',
          password: 'SecurePassword123',
          displayName: 'AliceStudent'
        }
      });

      assert.equal(res.statusCode, 201);
      const json = JSON.parse(res.body);
      assert.equal(json.user.email, 'student1@school.edu');
      assert.equal(json.user.role, UserRole.STUDENT);
      assert.ok(json.user.id);
      assert.equal(json.user.password_hash, undefined, 'Password hash must never leak in responses');

      // Verify HttpOnly cookie
      const cookies = res.headers['set-cookie'];
      assert.ok(cookies, 'Set-Cookie header must be present');
      assert.match(String(cookies), /HttpOnly/i, 'Cookie must be HttpOnly');
      assert.match(String(cookies), /SameSite=Strict/i, 'Cookie must be SameSite=Strict');
    });

    it('rejects duplicate email registration (Conflict 409)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email: 'student1@school.edu',
          password: 'AnotherPassword999',
          displayName: 'ImposterAlice'
        }
      });

      assert.equal(res.statusCode, 409);
      const json = JSON.parse(res.body);
      assert.match(json.message, /already exists/i);
    });

    it('rejects weak password without numbers or uppercase (Bad Request 400)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email: 'weakpass@school.edu',
          password: 'weakpassword',
          displayName: 'WeakUser'
        }
      });

      assert.equal(res.statusCode, 400);
      const json = JSON.parse(res.body);
      assert.equal(json.error, 'Bad Request');
    });

    it('rejects XSS and malicious characters in displayName (Bad Request 400)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email: 'xssuser@school.edu',
          password: 'SecurePassword123',
          displayName: '<script>alert(1)</script>'
        }
      });

      assert.equal(res.statusCode, 400);
    });
  });

  describe('Privilege Escalation Prevention', () => {
    it('blocks student attempting to self-assign TEACHER role without authorization code', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email: 'wannabeteacher@school.edu',
          password: 'SecurePassword123',
          displayName: 'FakeTeacher',
          requestedRole: UserRole.TEACHER
        }
      });

      assert.equal(res.statusCode, 403);
      const json = JSON.parse(res.body);
      assert.match(json.message, /authorization code/i);
    });

    it('blocks student attempting to self-assign ADMIN role with invalid code', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email: 'wannabeadmin@school.edu',
          password: 'SecurePassword123',
          displayName: 'FakeAdmin',
          requestedRole: UserRole.ADMIN,
          invitationCode: 'guess_1234'
        }
      });

      assert.equal(res.statusCode, 403);
    });

    it('allows teacher registration when providing the authorized teacher secret code', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email: 'mr.smith@school.edu',
          password: 'SecureTeacherPassword123',
          displayName: 'MrSmith',
          requestedRole: UserRole.TEACHER,
          invitationCode: securityConfig.teacherRegistrationSecret
        }
      });

      assert.equal(res.statusCode, 201);
      const json = JSON.parse(res.body);
      assert.equal(json.user.role, UserRole.TEACHER);
    });
  });

  describe('Login & Credential Verification', () => {
    it('successfully logs in with valid credentials and sets cookie', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: 'student1@school.edu',
          password: 'SecurePassword123'
        }
      });

      assert.equal(res.statusCode, 200);
      const json = JSON.parse(res.body);
      assert.equal(json.user.email, 'student1@school.edu');
      assert.ok(json.token);
    });

    it('rejects incorrect password with generic 401 error', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: 'student1@school.edu',
          password: 'WrongPassword999'
        }
      });

      assert.equal(res.statusCode, 401);
      const json = JSON.parse(res.body);
      assert.equal(json.message, 'Invalid email or password');
    });

    it('rejects non-existent email with identical generic 401 error (prevents enumeration)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: 'nonexistent@school.edu',
          password: 'AnyPassword123'
        }
      });

      assert.equal(res.statusCode, 401);
      const json = JSON.parse(res.body);
      assert.equal(json.message, 'Invalid email or password');
    });
  });

  describe('Role-Based Access Control (RBAC) Enforcement', () => {
    let studentToken: string;
    let teacherToken: string;

    before(async () => {
      // Login student to obtain token
      const sLogin = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'student1@school.edu', password: 'SecurePassword123' }
      });
      studentToken = JSON.parse(sLogin.body).token;

      // Login teacher to obtain token
      const tLogin = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'mr.smith@school.edu', password: 'SecureTeacherPassword123' }
      });
      teacherToken = JSON.parse(tLogin.body).token;
    });

    it('rejects unauthenticated request to protected endpoints with 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/teacher-test'
      });
      assert.equal(res.statusCode, 401);
    });

    it('rejects student attempting to access teacher endpoint with 403 Forbidden', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/teacher-test',
        headers: {
          authorization: `Bearer ${studentToken}`
        }
      });

      assert.equal(res.statusCode, 403);
      const json = JSON.parse(res.body);
      assert.match(json.message, /Access denied/i);
    });

    it('grants teacher access to teacher-only endpoint with 200 OK', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/teacher-test',
        headers: {
          authorization: `Bearer ${teacherToken}`
        }
      });

      assert.equal(res.statusCode, 200);
      const json = JSON.parse(res.body);
      assert.match(json.message, /Access granted to Teacher Portal/i);
    });

    it('rejects teacher attempting to access admin-only endpoint with 403 Forbidden', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/admin-test',
        headers: {
          authorization: `Bearer ${teacherToken}`
        }
      });

      assert.equal(res.statusCode, 403);
    });
  });

  describe('Token Tampering & Signature Verification', () => {
    let studentToken: string;

    before(async () => {
      const sLogin = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'student1@school.edu', password: 'SecurePassword123' }
      });
      studentToken = JSON.parse(sLogin.body).token;
    });

    it('rejects forged JWT signed with an untrusted key (401 Unauthorized)', async () => {
      // Attacker creates a forged token with TEACHER role signed by attacker private key
      const forgedToken = jwt.sign(
        { userId: 'fake-id', email: 'attacker@evil.com', role: UserRole.TEACHER, displayName: 'Hacker' },
        'attacker-secret-key-1234567890'
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/teacher-test',
        headers: {
          authorization: `Bearer ${forgedToken}`
        }
      });

      assert.equal(res.statusCode, 401);
    });

    it('rejects modified JWT payload where signature is invalid (401 Unauthorized)', async () => {
      const parts = studentToken.split('.');
      // Tamper with payload by modifying middle base64 segment
      const tamperedToken = `${parts[0]}.${parts[1]}A.${parts[2]}`;

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: {
          authorization: `Bearer ${tamperedToken}`
        }
      });

      assert.equal(res.statusCode, 401);
    });

    it('rejects expired tokens (401 Unauthorized)', async () => {
      // Sign an already expired token with valid server key
      const expiredToken = jwt.sign(
        { userId: 'student-id', email: 'exp@school.edu', role: UserRole.STUDENT, displayName: 'ExpUser' },
        securityConfig.jwtSecret,
        { expiresIn: '-1s' }
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: {
          authorization: `Bearer ${expiredToken}`
        }
      });

      assert.equal(res.statusCode, 401);
    });
  });
});
