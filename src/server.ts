import path from 'path';
import Fastify, { type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import type { VerifyClientCallbackAsync } from 'ws';
import { handleConnection } from './ws-handler.js';

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval'",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "connect-src 'self'",
  "img-src 'self' data:",
].join('; ');

const MAX_WS_PAYLOAD = 64 * 1024;
const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

function isEnabled(value?: string): boolean {
  return value !== undefined && TRUE_VALUES.has(value.trim().toLowerCase());
}

export function parseAllowedOrigins(value = process.env.WS_ALLOWED_ORIGINS): Set<string> | null {
  const origins = value
    ?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return origins?.length ? new Set(origins) : null;
}

export function resolveClientIp(request: Pick<FastifyRequest, 'headers' | 'ip'>, trustProxy: boolean): string {
  if (!trustProxy) return request.ip;

  const forwardedFor = request.headers['x-forwarded-for'];
  const headerValue = Array.isArray(forwardedFor)
    ? forwardedFor.at(-1)
    : forwardedFor;

  if (!headerValue) return request.ip;

  const ips = headerValue
    .split(',')
    .map((ip) => ip.trim())
    .filter(Boolean);

  return ips.at(-1) ?? request.ip;
}

export function createOriginVerifier(allowedOrigins: Set<string> | null): VerifyClientCallbackAsync | undefined {
  if (!allowedOrigins) return undefined;

  return (info, next) => {
    const origin = info.origin ?? info.req.headers.origin;
    next(Boolean(origin && allowedOrigins.has(origin)), 403, 'origin not allowed');
  };
}

export async function createApp(env: NodeJS.ProcessEnv = process.env) {
  const parsedPort = Number(env.PORT);
  const port = Number.isFinite(parsedPort) ? parsedPort : 3000;
  const trustProxy = isEnabled(env.TRUST_PROXY);
  const allowedOrigins = parseAllowedOrigins(env.WS_ALLOWED_ORIGINS);

  const app = Fastify({ logger: true });

  app.addHook('onSend', (_request, reply, _payload, done) => {
    reply.header('Content-Security-Policy', CSP);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    done();
  });

  await app.register(fastifyStatic, {
    root: path.join(import.meta.dirname, '..', 'public'),
  });

  await app.register(fastifyWebsocket, {
    options: {
      maxPayload: MAX_WS_PAYLOAD,
      verifyClient: createOriginVerifier(allowedOrigins),
    },
  });

  app.get('/ws', { websocket: true }, (socket, request) => {
    handleConnection(socket, request, app.log, resolveClientIp(request, trustProxy));
  });

  return { app, port };
}

export async function start(env: NodeJS.ProcessEnv = process.env) {
  const { app, port } = await createApp(env);
  await app.listen({ port, host: '0.0.0.0' });
  return app;
}
