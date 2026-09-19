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
 */
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const app = await getApp();
  app.server.emit('request', req, res);
}
