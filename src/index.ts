import path from 'path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import { handleConnection } from './ws-handler.js';

const port = Number(process.env.PORT) || 3000;

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval'",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "connect-src 'self'",
  "img-src 'self' data:",
].join('; ');

async function start() {
  const app = Fastify({ logger: true, trustProxy: true });

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
    options: { maxPayload: 64 * 1024 }, // 64 KB max WebSocket message
  });

  app.get('/ws', { websocket: true }, (socket, request) => {
    handleConnection(socket, request, app.log);
  });

  await app.listen({ port, host: '0.0.0.0' });
}

start();
