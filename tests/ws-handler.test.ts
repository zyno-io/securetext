import { it, expect, afterEach } from 'vitest';
import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { handleConnection, senders } from '../src/ws-handler.js';

const noopLog = {
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
  fatal: () => {},
  trace: () => {},
  child: () => noopLog,
} as any;

function setup() {
  const server = createServer();
  const wss = new WebSocketServer({ server });
  wss.on('connection', (ws, req) => {
    const url = new URL(req.url!, 'http://localhost');
    const query = Object.fromEntries(url.searchParams) as Record<string, string>;
    handleConnection(ws as any, { query, ip: '127.0.0.1' } as any, noopLog);
  });
  return { server, wss };
}

function listen(server: ReturnType<typeof createServer>): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve((server.address() as { port: number }).port);
    });
  });
}

function connect(port: number, query = ''): WebSocket {
  return new WebSocket(`ws://127.0.0.1:${port}${query}`);
}

function waitMsg(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    ws.once('message', (d) => resolve(JSON.parse(d.toString())));
  });
}

function waitClose(ws: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    ws.once('close', (code, reason) => resolve({ code, reason: reason.toString() }));
  });
}

function teardown(wss: WebSocketServer, server: ReturnType<typeof createServer>) {
  senders.clear();
  for (const c of wss.clients) c.terminate();
  wss.close();
  server.close();
}

it('assigns a uuid to a new sender', async () => {
  const { server, wss } = setup();
  const port = await listen(server);

  const ws = connect(port);
  const msg = await waitMsg(ws);

  expect(msg.type).toBe('hello');
  expect(typeof msg.uuid).toBe('string');
  expect((msg.uuid as string).length).toBeGreaterThan(0);
  expect(senders.size).toBeGreaterThanOrEqual(1);

  ws.close();
  teardown(wss, server);
});

it('relays messages from receiver to sender', async () => {
  const { server, wss } = setup();
  const port = await listen(server);

  const senderWs = connect(port);
  const hello = await waitMsg(senderWs);
  const uuid = hello.uuid as string;

  const receiverWs = connect(port, `?sender=${uuid}`);

  // Wait for receiver to be connected, then send
  await new Promise((r) => receiverWs.on('open', r));
  const senderMsgP = waitMsg(senderWs);
  receiverWs.send(JSON.stringify({ type: 'pubkey', key: 'testkey' }));
  const relayed = await senderMsgP;

  expect(relayed.type).toBe('pubkey');
  expect(relayed.key).toBe('testkey');

  senderWs.close();
  receiverWs.close();
  teardown(wss, server);
});

it('relays messages from sender to receiver', async () => {
  const { server, wss } = setup();
  const port = await listen(server);

  const senderWs = connect(port);
  const hello = await waitMsg(senderWs);

  const receiverWs = connect(port, `?sender=${hello.uuid}`);
  await new Promise((r) => receiverWs.on('open', r));

  const receiverMsgP = waitMsg(receiverWs);
  senderWs.send(JSON.stringify({ type: 'encmsg', data: 'secret' }));
  const relayed = await receiverMsgP;

  expect(relayed.type).toBe('encmsg');
  expect(relayed.data).toBe('secret');

  senderWs.close();
  receiverWs.close();
  teardown(wss, server);
});

it('rejects receiver when sender does not exist', async () => {
  const { server, wss } = setup();
  const port = await listen(server);

  const ws = connect(port, '?sender=nonexistent');
  const { code, reason } = await waitClose(ws);

  expect(code).toBe(4404);
  expect(reason).toBe('no such sender');

  teardown(wss, server);
});

it('rejects a second receiver', async () => {
  const { server, wss } = setup();
  const port = await listen(server);

  const senderWs = connect(port);
  const hello = await waitMsg(senderWs);

  const receiver1 = connect(port, `?sender=${hello.uuid}`);
  await new Promise((r) => receiver1.on('open', r));

  const receiver2 = connect(port, `?sender=${hello.uuid}`);
  const { code, reason } = await waitClose(receiver2);

  expect(code).toBe(4409);
  expect(reason).toBe('receiver already connected');

  senderWs.close();
  receiver1.close();
  teardown(wss, server);
});

it('notifies receiver when sender disconnects', async () => {
  const { server, wss } = setup();
  const port = await listen(server);

  const senderWs = connect(port);
  const hello = await waitMsg(senderWs);

  const receiverWs = connect(port, `?sender=${hello.uuid}`);
  await new Promise((r) => receiverWs.on('open', r));

  const receiverMsgP = waitMsg(receiverWs);
  senderWs.close();
  const msg = await receiverMsgP;

  expect(msg.type).toBe('sdisconnect');

  receiverWs.close();
  teardown(wss, server);
});

it('notifies sender when receiver disconnects', async () => {
  const { server, wss } = setup();
  const port = await listen(server);

  const senderWs = connect(port);
  const hello = await waitMsg(senderWs);

  const receiverWs = connect(port, `?sender=${hello.uuid}`);
  await new Promise((r) => receiverWs.on('open', r));

  const senderMsgP = waitMsg(senderWs);
  receiverWs.close();
  const msg = await senderMsgP;

  expect(msg.type).toBe('rdisconnect');

  senderWs.close();
  teardown(wss, server);
});

it('cleans up sender from registry on disconnect', async () => {
  const { server, wss } = setup();
  const port = await listen(server);

  const ws = connect(port);
  const hello = await waitMsg(ws);
  const uuid = hello.uuid as string;

  expect(senders.has(uuid)).toBe(true);

  const closeP = waitClose(ws);
  ws.close();
  await closeP;
  await new Promise((r) => setTimeout(r, 50));

  expect(senders.has(uuid)).toBe(false);

  teardown(wss, server);
});

it('rejects connections exceeding per-IP limit', async () => {
  const { server, wss } = setup();
  const port = await listen(server);

  // Open 5 connections (the limit)
  const connections: WebSocket[] = [];
  for (let i = 0; i < 5; i++) {
    const ws = connect(port);
    await waitMsg(ws); // wait for hello
    connections.push(ws);
  }

  // 6th should be rejected
  const ws6 = connect(port);
  const { code, reason } = await waitClose(ws6);

  expect(code).toBe(4429);
  expect(reason).toBe('too many connections');

  for (const ws of connections) ws.close();
  teardown(wss, server);
});
