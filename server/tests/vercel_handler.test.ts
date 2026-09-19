import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import handler from '../api/index.js';

describe('Vercel Serverless Function Handler Suite', () => {
  let server: http.Server;
  let serverAddress: string;

  before(async () => {
    server = http.createServer((req, res) => {
      handler(req, res);
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as any;
        serverAddress = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('serves /health check via Vercel serverless handler', async () => {
    const res = await fetch(`${serverAddress}/health`);
    assert.strictEqual(res.status, 200);
    const json = await res.json();
    assert.strictEqual(json.status, 'healthy');
    assert.ok(typeof json.timestamp === 'number');
  });

  it('serves root / status info or client static index via Vercel serverless handler', async () => {
    const res = await fetch(`${serverAddress}/`);
    assert.strictEqual(res.status, 200);
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const json = await res.json();
      assert.strictEqual(json.name, 'MindPulse Arena Server API');
      assert.strictEqual(json.status, 'online');
    } else {
      const text = await res.text();
      assert.ok(text.toLowerCase().includes('<!doctype html') || text.includes('<div id="root">'));
    }
  });

  it('correctly routes /api/v1/auth/me to Fastify returning 401 when unauthenticated', async () => {
    const res = await fetch(`${serverAddress}/api/v1/auth/me`);
    assert.strictEqual(res.status, 401);
    const json = await res.json();
    assert.strictEqual(json.statusCode, 401);
  });
});
