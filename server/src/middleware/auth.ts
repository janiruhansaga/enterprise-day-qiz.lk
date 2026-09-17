import { FastifyRequest, FastifyReply } from 'fastify';
import { verifyAuthToken, TokenPayload } from '../auth/crypto.js';
import { securityConfig, UserRole } from '../config/security.js';
import { defaultRevocationService } from '../auth/revocation.js';
import { getFirebaseAuth, isFirebaseAdminAvailable } from '../config/firebase.js';
import { IDatastore } from '../db/datastore.interface.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: TokenPayload;
  }
}

/**
 * Universal authoritative token verifier:
 * 1. Checks revocation list.
 * 2. If Firebase Admin is available, attempts verifyIdToken(token).
 *    - Resolves UID, email, custom claims (role).
 *    - Cross-references database if db is provided for definitive role assignment.
 * 3. Falls back to internal cryptographic JWT verification (for tests / legacy tokens).
 */
export async function verifyAnyToken(token: string, db?: IDatastore): Promise<TokenPayload | null> {
  if (!token) return null;

  if (defaultRevocationService.isRevoked(token)) {
    return null;
  }

  // 1. Try Firebase Admin ID Token verification if available
  if (isFirebaseAdminAvailable()) {
    try {
      const auth = getFirebaseAuth();
      const decoded = await auth.verifyIdToken(token, false);

      let assignedRole: UserRole | null = null;
      const claimRole = (decoded.role || (decoded as any).claims?.role || '')?.toString().toUpperCase();
      if (claimRole === 'TEACHER') {
        assignedRole = UserRole.TEACHER;
      } else if (claimRole === 'ADMIN') {
        assignedRole = UserRole.ADMIN;
      } else if (db) {
        // Authoritatively check datastore by Firebase UID, then by email
        let userRecord = await db.findUserById(decoded.uid);
        if (!userRecord && decoded.email) {
          userRecord = await db.findUserByEmail(decoded.email);
        }
        if (userRecord && (userRecord.role === UserRole.TEACHER || userRecord.role === UserRole.ADMIN)) {
          assignedRole = userRecord.role;
        }
      }

      // CRITICAL ZERO-TRUST RULE:
      // Firebase Authentication is ONLY for teachers and admins.
      // Unregistered / unverified Google users are NEVER assigned STUDENT role.
      // If the user has not completed teacher registration, deny access.
      if (!assignedRole) {
        return null;
      }

      return {
        userId: decoded.uid,
        email: decoded.email || '',
        role: assignedRole,
        displayName: decoded.name || decoded.email?.split('@')[0] || 'Teacher'
      };
    } catch {
      // Not a valid Firebase ID token or verification failed; proceed to internal JWT fallback
    }
  }

  // 2. Fallback to internal cryptographic JWT token verification
  return verifyAuthToken(token);
}

/**
 * Middleware: Extract and verify authentication token from HttpOnly cookie or Bearer header.
 * Attaches verified payload to req.user.
 */
export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  let token: string | undefined;

  // 1. Check HttpOnly cookie first (primary browser client vector)
  const cookieToken = request.cookies[securityConfig.cookieName];
  if (cookieToken) {
    token = cookieToken;
  } else {
    // 2. Fallback to Authorization: Bearer <token> header for API testing/tools
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    }
  }

  if (!token) {
    return reply.status(401).send({
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Authentication token missing or invalid'
    });
  }

  if (defaultRevocationService.isRevoked(token)) {
    return reply.status(401).send({
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Token has been revoked'
    });
  }

  const db = (request.server as any).db as IDatastore | undefined;
  const payload = await verifyAnyToken(token, db);
  if (!payload) {
    return reply.status(401).send({
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Invalid or expired session token'
    });
  }

  request.user = payload;
}

/**
 * RBAC Guard Middleware: Ensures authenticated user has one of the allowed roles.
 * Never trusts any role parameter from the request body or query params.
 */
export function requireRole(...allowedRoles: UserRole[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Authentication required'
      });
    }

    if (!allowedRoles.includes(request.user.role)) {
      return reply.status(403).send({
        statusCode: 403,
        error: 'Forbidden',
        message: `Access denied. Requires one of roles: [${allowedRoles.join(', ')}]. Current role: ${request.user.role}`
      });
    }
  };
}
