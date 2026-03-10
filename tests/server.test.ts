import { afterEach, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { WebSocket } from 'ws';
import { createApp, resolveClientIp } from '../src/server.js';

const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function listen(env: NodeJS.ProcessEnv = {}) {
  const { app } = await createApp({ ...process.env, ...env, PORT: '0' });
  apps.push(app);
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to resolve listening address');
  }
  return { app, port: address.port };
}

function waitForMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    ws.once('message', (message) => resolve(JSON.parse(message.toString())));
  });
}

function waitForUnexpectedResponse(ws: WebSocket): Promise<number> {
  return new Promise((resolve) => {
    ws.once('unexpected-response', (_request, response) => resolve(response.statusCode ?? 0));
  });
}

it('allows websocket connections from an allowed origin', async () => {
  const { port } = await listen({ WS_ALLOWED_ORIGINS: 'https://securetext.example' });
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
    headers: { origin: 'https://securetext.example' },
  });

  const hello = await waitForMessage(ws);
  expect(hello.type).toBe('hello');
  ws.close();
});

it('rejects websocket connections from a disallowed origin', async () => {
  const { port } = await listen({ WS_ALLOWED_ORIGINS: 'https://securetext.example' });
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
    headers: { origin: 'https://evil.example' },
  });

  expect(await waitForUnexpectedResponse(ws)).toBe(403);
});

it('uses the last forwarded IP only when proxy trust is enabled', () => {
  const request = {
    ip: '127.0.0.1',
    headers: {
      'x-forwarded-for': '198.51.100.10, 203.0.113.5',
    },
  } as const;

  expect(resolveClientIp(request as any, false)).toBe('127.0.0.1');
  expect(resolveClientIp(request as any, true)).toBe('203.0.113.5');
});
