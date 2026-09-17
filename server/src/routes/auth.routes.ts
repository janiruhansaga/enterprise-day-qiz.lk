import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import crypto from 'node:crypto';
import { RegisterSchema, LoginSchema } from '../auth/schemas.js';
import { hashPassword, verifyPassword, signAuthToken } from '../auth/crypto.js';
import { securityConfig, UserRole } from '../config/security.js';
import { IDatastore } from '../db/datastore.interface.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { registerRateLimiter, loginRateLimiter } from '../middleware/rateLimiter.js';
import { defaultRevocationService } from '../auth/revocation.js';
import { getFirebaseAuth, isFirebaseAdminAvailable } from '../config/firebase.js';

export function createAuthRoutes(db: IDatastore): FastifyPluginAsync {
  return async (fastify: FastifyInstance) => {

    // POST /api/v1/auth/register (Rate Limited)
    fastify.post('/register', { preHandler: [registerRateLimiter.middleware('register')] }, async (request, reply) => {
      const parseResult = RegisterSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Validation failed',
          errors: parseResult.error.flatten().fieldErrors
        });
      }

      const { email, password, displayName, requestedRole, invitationCode } = parseResult.data;

      // Check if user already exists
      const existingUser = await db.findUserByEmail(email);
      if (existingUser) {
        return reply.status(409).send({
          statusCode: 409,
          error: 'Conflict',
          message: 'An account with this email address already exists'
        });
      }

      // Enforce authorization for elevated roles
      let assignedRole = UserRole.STUDENT;
      if (requestedRole === UserRole.TEACHER) {
        const expectedSecret = securityConfig.teacherRegistrationSecret?.trim();
        const providedCode = invitationCode?.trim();
        if (!providedCode || providedCode !== expectedSecret) {
          return reply.status(403).send({
            statusCode: 403,
            error: 'Forbidden',
            message: 'Invalid or missing teacher authorization code'
          });
        }
        assignedRole = UserRole.TEACHER;
      } else if (requestedRole === UserRole.ADMIN) {
        const expectedSecret = securityConfig.adminRegistrationSecret?.trim();
        const providedCode = invitationCode?.trim();
        if (!providedCode || providedCode !== expectedSecret) {
          return reply.status(403).send({
            statusCode: 403,
            error: 'Forbidden',
            message: 'Invalid or missing admin authorization code'
          });
        }
        assignedRole = UserRole.ADMIN;
      }

      // Hash password using memory-hard scrypt + salt
      const passwordHash = await hashPassword(password);
      const userId = crypto.randomUUID();
      const createdAt = Date.now();

      await db.createUser({
        id: userId,
        email,
        password_hash: passwordHash,
        role: assignedRole,
        display_name: displayName,
        created_at: createdAt
      });

      // Generate secure token
      const token = signAuthToken({
        userId,
        email,
        role: assignedRole,
        displayName
      });

      // Set HttpOnly, Secure, SameSite cookie
      reply.setCookie(securityConfig.cookieName, token, {
        path: '/',
        httpOnly: true,
        secure: securityConfig.isProduction,
        sameSite: 'strict',
        maxAge: securityConfig.jwtExpiresInSec
      });

      return reply.status(201).send({
        statusCode: 201,
        message: 'Registration successful',
        user: {
          id: userId,
          email,
          role: assignedRole,
          displayName
        },
        token // Provided for non-browser/API clients
      });
    });

    // POST /api/v1/auth/login (Rate Limited)
    fastify.post('/login', { preHandler: [loginRateLimiter.middleware('login')] }, async (request, reply) => {
      const parseResult = LoginSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Validation failed'
        });
      }

      const { email, password } = parseResult.data;
      const user = await db.findUserByEmail(email);

      // Protect against user enumeration by timing-consistent check
      if (!user) {
        // Execute dummy verification to avoid timing discrepancy
        await verifyPassword(password, 'scrypt$16384$8$1$0000000000000000$00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000');
        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Invalid email or password'
        });
      }

      const isMatch = await verifyPassword(password, user.password_hash);
      if (!isMatch) {
        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Invalid email or password'
        });
      }

      const token = signAuthToken({
        userId: user.id,
        email: user.email,
        role: user.role,
        displayName: user.display_name
      });

      reply.setCookie(securityConfig.cookieName, token, {
        path: '/',
        httpOnly: true,
        secure: securityConfig.isProduction,
        sameSite: 'strict',
        maxAge: securityConfig.jwtExpiresInSec
      });

      return reply.status(200).send({
        statusCode: 200,
        message: 'Login successful',
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          displayName: user.display_name
        },
        token
      });
    });

    // POST /api/v1/auth/firebase-login (Rate Limited)
    fastify.post('/firebase-login', { preHandler: [loginRateLimiter.middleware('login')] }, async (request, reply) => {
      let idToken: string | undefined;
      const authHeader = request.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        idToken = authHeader.substring(7).trim();
      } else if (request.body && typeof request.body === 'object' && 'idToken' in request.body) {
        idToken = (request.body as any).idToken;
      }

      if (!idToken) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Firebase ID token is required'
        });
      }

      let decoded: any;
      try {
        const auth = getFirebaseAuth();
        decoded = await auth.verifyIdToken(idToken, false);
      } catch (err: any) {
        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Invalid or expired Firebase ID token'
        });
      }

      const uid = decoded.uid;
      const email = (decoded.email || '').toLowerCase();

      // Check if user is already an authorized teacher by Firebase UID or email
      let user = await db.findUserById(uid);
      if (!user && email) {
        user = await db.findUserByEmail(email);
      }

      const claimRole = (decoded.role || (decoded as any).claims?.role || '')?.toString().toUpperCase();
      const isAuthorizedTeacher =
        (user && (user.role === UserRole.TEACHER || user.role === UserRole.ADMIN)) ||
        claimRole === 'TEACHER' ||
        claimRole === 'ADMIN';

      if (!isAuthorizedTeacher) {
        return reply.status(403).send({
          statusCode: 403,
          error: 'Forbidden',
          code: 'TEACHER_REGISTRATION_CODE_REQUIRED',
          message: 'Teacher authorization required. Please enter your Teacher Registration Code.'
        });
      }

      // If user wasn't stored under this exact UID, ensure record exists
      if (!user) {
        const finalDisplayName = decoded.name || email.split('@')[0] || 'Teacher';
        const teacherRecord: UserRecord = {
          id: uid,
          email,
          password_hash: 'FIREBASE_AUTH',
          role: UserRole.TEACHER,
          display_name: finalDisplayName,
          created_at: Date.now()
        };
        if (typeof (db as any).upsertTeacherUser === 'function') {
          await (db as any).upsertTeacherUser(teacherRecord);
        } else {
          await db.createUser(teacherRecord);
        }
        user = (await db.findUserById(uid)) || teacherRecord;
      }

      // Ensure custom claim is synced on Firebase user
      try {
        const auth = getFirebaseAuth();
        await auth.setCustomUserClaims(uid, { role: user.role.toLowerCase() });
      } catch {
        // Non-fatal if claims assignment fails in unit tests or offline
      }

      const token = signAuthToken({
        userId: user.id,
        email: user.email,
        role: user.role,
        displayName: user.display_name
      });

      reply.setCookie(securityConfig.cookieName, token, {
        path: '/',
        httpOnly: true,
        secure: securityConfig.isProduction,
        sameSite: 'strict',
        maxAge: securityConfig.jwtExpiresInSec
      });

      return reply.status(200).send({
        statusCode: 200,
        message: 'Login successful',
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          displayName: user.display_name
        },
        token: idToken
      });
    });

    // POST /api/v1/auth/firebase-register (Rate Limited)
    fastify.post('/firebase-register', { preHandler: [registerRateLimiter.middleware('register')] }, async (request, reply) => {
      let idToken: string | undefined;
      const authHeader = request.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        idToken = authHeader.substring(7).trim();
      } else if (request.body && typeof request.body === 'object' && 'idToken' in request.body) {
        idToken = (request.body as any).idToken;
      }

      if (!idToken) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Firebase ID token is required'
        });
      }

      const body = (request.body && typeof request.body === 'object') ? request.body as any : {};
      const { displayName, invitationCode } = body;

      // Validate teacher registration code with timing-safe comparison
      const expectedSecret = securityConfig.teacherRegistrationSecret?.trim();
      const providedCode = invitationCode?.trim();

      let isValidCode = false;
      if (expectedSecret && providedCode && expectedSecret.length === providedCode.length) {
        isValidCode = crypto.timingSafeEqual(Buffer.from(expectedSecret), Buffer.from(providedCode));
      }

      if (!isValidCode) {
        // Do NOT reveal the correct code and do NOT log the submitted code
        return reply.status(403).send({
          statusCode: 403,
          error: 'Forbidden',
          message: 'Invalid or missing teacher registration code'
        });
      }

      let decoded: any;
      try {
        const auth = getFirebaseAuth();
        decoded = await auth.verifyIdToken(idToken, false);
      } catch (err: any) {
        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Invalid or expired Firebase ID token'
        });
      }

      const uid = decoded.uid;
      const email = (decoded.email || '').toLowerCase();
      const finalDisplayName = displayName?.trim() || decoded.name || email.split('@')[0] || 'Teacher';

      // Authoritatively persist teacher with Firebase UID as the identity
      const teacherRecord: UserRecord = {
        id: uid,
        email,
        password_hash: 'FIREBASE_AUTH',
        role: UserRole.TEACHER,
        display_name: finalDisplayName,
        created_at: Date.now()
      };

      if (typeof (db as any).upsertTeacherUser === 'function') {
        await (db as any).upsertTeacherUser(teacherRecord);
      } else {
        const existing = (await db.findUserById(uid)) || (email ? await db.findUserByEmail(email) : null);
        if (!existing) {
          await db.createUser(teacherRecord);
        }
      }

      const user = (await db.findUserById(uid)) || (email ? await db.findUserByEmail(email) : null) || teacherRecord;

      // Authoritatively set custom claim { role: "teacher" } on Firebase user
      try {
        const auth = getFirebaseAuth();
        await auth.setCustomUserClaims(uid, { role: 'teacher' });
      } catch {
        // Non-fatal in testing or offline
      }

      const token = signAuthToken({
        userId: user.id,
        email: user.email,
        role: UserRole.TEACHER,
        displayName: user.display_name
      });

      reply.setCookie(securityConfig.cookieName, token, {
        path: '/',
        httpOnly: true,
        secure: securityConfig.isProduction,
        sameSite: 'strict',
        maxAge: securityConfig.jwtExpiresInSec
      });

      return reply.status(201).send({
        statusCode: 201,
        message: 'Teacher registration successful',
        user: {
          id: user.id,
          email: user.email,
          role: UserRole.TEACHER,
          displayName: user.display_name
        },
        token: idToken
      });
    });

    // POST /api/v1/auth/logout
    fastify.post('/logout', async (request, reply) => {
      // Extract token to revoke
      let token = request.cookies[securityConfig.cookieName];
      if (!token) {
        const authHeader = request.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
          token = authHeader.substring(7).trim();
        }
      }

      if (token) {
        defaultRevocationService.revoke(token);
      }

      reply.clearCookie(securityConfig.cookieName, {
        path: '/',
        httpOnly: true,
        secure: securityConfig.isProduction,
        sameSite: 'strict'
      });

      return reply.status(200).send({
        statusCode: 200,
        message: 'Logged out successfully'
      });
    });

    // GET /api/v1/auth/me
    fastify.get('/me', { preHandler: [authenticate] }, async (request, reply) => {
      return reply.send({
        user: request.user
      });
    });

    // GET /api/v1/auth/teacher-test (Protected Teacher Endpoint)
    fastify.get(
      '/teacher-test',
      { preHandler: [authenticate, requireRole(UserRole.TEACHER, UserRole.ADMIN)] },
      async (request, reply) => {
        return reply.send({
          message: 'Access granted to Teacher Portal',
          user: request.user
        });
      }
    );

    // GET /api/v1/auth/admin-test (Protected Admin Endpoint)
    fastify.get(
      '/admin-test',
      { preHandler: [authenticate, requireRole(UserRole.ADMIN)] },
      async (request, reply) => {
        return reply.send({
          message: 'Access granted to Administrator Control Center',
          user: request.user
        });
      }
    );
  };
}
