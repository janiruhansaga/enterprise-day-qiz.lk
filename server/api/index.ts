import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildApp, AppInstance } from '../src/app.js';
import { createDatastore } from '../src/db/datastoreFactory.js';

let appInstance: AppInstance | null = null;
let initPromise: Promise<AppInstance> | null = null;

async function getApp(): Promise<AppInstance> {
  if (appInstance) {
    return appInstance;
  }

  if (!initPromise) {
    initPromise = (async () => {
      const datastore = createDatastore();
      const app = buildApp(datastore);
      await app.ready();
      appInstance = app;
      return app;
    })();
  }

  return initPromise;
}

/**
 * Vercel Serverless Function entrypoint handler.
 * Proxies incoming HTTP requests directly into Fastify's native Node HTTP pipeline.
 *
 * ARCHITECTURAL NOTICE:
 * Vercel Serverless Functions execute as ephemeral, stateless micro-invocations.
 * They support standard REST endpoints (/api/v1/auth, /api/v1/quizzes, /api/v1/games, /health).
 * They DO NOT support persistent duplex TCP sockets or WebSocket upgrades ('upgrade' event).
 * Real-time Socket.IO multiplayer battle gameplay requires a persistent Node.js runtime
 * (server.ts via Docker / Railway / Render / Fly.io / Google Cloud Run).
 */
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const app = await getApp();
  app.server.emit('request', req, res);
}
