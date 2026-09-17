import Fastify, { FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import { Server as SocketIOServer } from 'socket.io';
import { IDatastore } from './db/datastore.interface.js';
import { defaultDatabase } from './db/database.js';
import { createAuthRoutes } from './routes/auth.routes.js';
import { createQuizRoutes } from './routes/quiz.routes.js';
import { createGameRoutes } from './routes/game.routes.js';
import { GameSocketManager } from './sockets/gameSocket.js';

import fastifyHelmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import fs from 'node:fs';

export interface AppInstance extends FastifyInstance {
  io?: SocketIOServer;
  gameSocketManager?: GameSocketManager;
  db?: IDatastore;
}

export function buildApp(db: IDatastore = defaultDatabase): AppInstance {
  const app = Fastify({
    logger: false
  }) as AppInstance;

  app.decorate('db', db);

  // Security Headers: CSP, X-Content-Type-Options, Strict-Transport-Security
  app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        connectSrc: [
          "'self'",
          'ws:',
          'wss:',
          'http://localhost:*',
          'ws://localhost:*',
          'http://127.0.0.1:*',
          'ws://127.0.0.1:*',
          'https://*.googleapis.com',
          'https://*.firebaseio.com',
          'https://*.firebaseapp.com',
          'https://identitytoolkit.googleapis.com',
          'https://securetoken.googleapis.com'
        ],
        imgSrc: ["'self'", 'data:', 'https://*.googleusercontent.com'],
        scriptSrc: ["'self'", "'unsafe-inline'", 'https://apis.google.com', 'https://*.firebaseapp.com'],
        frameSrc: ["'self'", 'https://*.firebaseapp.com', 'https://accounts.google.com']
      }
    },
    crossOriginResourcePolicy: { policy: 'cross-origin' }
  });

  // Register plugins
  app.register(fastifyCookie);
  app.register(fastifyCors, {
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
  });

  // Serve client static production bundle if present
  const clientDistPath = path.resolve(process.cwd(), '..', 'client', 'dist');
  if (fs.existsSync(clientDistPath)) {
    app.register(fastifyStatic, {
      root: clientDistPath,
      prefix: '/'
    });

    // SPA client-side routing fallback
    app.setNotFoundHandler((req, reply) => {
      if (req.raw.url?.startsWith('/api')) {
        return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'API route not found' });
      }
      return reply.sendFile('index.html');
    });
  }

  // Health check endpoint
  app.get('/health', async () => {
    return { status: 'healthy', timestamp: Date.now() };
  });

  // Register API routes
  app.register(createAuthRoutes(db), { prefix: '/api/v1/auth' });
  app.register(createQuizRoutes(db), { prefix: '/api/v1/quizzes' });
  app.register(createGameRoutes(db), { prefix: '/api/v1/games' });

  // Initialize Socket.io attached to the underlying HTTP server
  const io = new SocketIOServer(app.server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
      credentials: true
    }
  });

  const gameSocketManager = new GameSocketManager(io, db);
  app.io = io;
  app.gameSocketManager = gameSocketManager;

  return app;
}

