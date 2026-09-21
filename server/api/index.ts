import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildApp, AppInstance } from '../src/app.js';
import { createDatastore } from '../src/db/datastoreFactory.js';
import { isFirebaseAdminAvailable } from '../src/config/firebase.js';

let appInstance: AppInstance | null = null;
let initPromise: Promise<AppInstance> | null = null;

async function getApp(): Promise<AppInstance> {
  if (appInstance) {
    return appInstance;
  }

  if (!initPromise) {
    initPromise = (async () => {
      const datastore = isFirebaseAdminAvailable() ? createDatastore('firestore') : createDatastore();
      const app = buildApp(datastore, { enableRealtime: false });
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
 * This serverless build runs WITHOUT Socket.IO. Real-time play is driven by:
 * 1. REST actions under /api/v1/games (join, answers, start, next, finish-round, kick, leaderboard, podium, state)
 * 2. Firestore `state/public` documents that clients subscribe to for push updates.
 */
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const app = await getApp();
  app.server.emit('request', req, res);
}
