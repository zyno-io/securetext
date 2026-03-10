import crypto from 'crypto';
import type { WebSocket } from 'ws';
import type { FastifyRequest, FastifyBaseLogger } from 'fastify';
import baseX from 'base-x';

const base62 = baseX('0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ');

const TIMEOUT_MS = 300_000; // 5 minutes
const MAX_CONNECTIONS_PER_IP = 5;

interface Connection {
  ws: WebSocket;
  role: 'sender' | 'receiver';
  uuid?: string;
  peer?: Connection;
  timeout: ReturnType<typeof setTimeout>;
  log: FastifyBaseLogger;
  ip: string;
}

export const senders = new Map<string, Connection>();
const connectionsPerIp = new Map<string, number>();

function send(conn: Connection, obj: Record<string, unknown>) {
  conn.ws.send(JSON.stringify(obj));
}

function resetTimeout(conn: Connection) {
  clearTimeout(conn.timeout);
  conn.timeout = setTimeout(() => {
    conn.log.info('closing idle connection');
    conn.ws.close();
  }, TIMEOUT_MS);
}

function trackIp(ip: string): boolean {
  const count = connectionsPerIp.get(ip) ?? 0;
  if (count >= MAX_CONNECTIONS_PER_IP) return false;
  connectionsPerIp.set(ip, count + 1);
  return true;
}

function untrackIp(ip: string) {
  const count = connectionsPerIp.get(ip) ?? 1;
  if (count <= 1) {
    connectionsPerIp.delete(ip);
  } else {
    connectionsPerIp.set(ip, count - 1);
  }
}

function cleanup(conn: Connection) {
  clearTimeout(conn.timeout);
  untrackIp(conn.ip);

  if (conn.role === 'sender' && conn.uuid) {
    senders.delete(conn.uuid);
    if (conn.peer) {
      const receiver = conn.peer;
      delete receiver.peer;
      send(receiver, { type: 'sdisconnect' });
      receiver.ws.close();
    }
  } else if (conn.role === 'receiver') {
    if (conn.peer) {
      const sender = conn.peer;
      delete sender.peer;
      send(sender, { type: 'rdisconnect' });
    }
  }
}

export function handleConnection(
  ws: WebSocket,
  request: FastifyRequest,
  log: FastifyBaseLogger,
  clientIp = request.ip,
) {
  const query = request.query as Record<string, string>;
  const senderUuid = query.sender;
  const ip = clientIp;

  if (!trackIp(ip)) {
    ws.close(4429, 'too many connections');
    return;
  }

  if (senderUuid) {
    const sender = senders.get(senderUuid);
    if (!sender) {
      untrackIp(ip);
      ws.close(4404, 'no such sender');
      return;
    }
    if (sender.peer) {
      untrackIp(ip);
      ws.close(4409, 'receiver already connected');
      return;
    }
  }

  const conn: Connection = {
    ws,
    role: senderUuid ? 'receiver' : 'sender',
    timeout: setTimeout(() => {
      log.info('closing idle connection');
      ws.close();
    }, TIMEOUT_MS),
    log,
    ip,
  };

  if (senderUuid) {
    const sender = senders.get(senderUuid)!;
    conn.peer = sender;
    sender.peer = conn;
    log.info('receiver connected to sender');
  } else {
    const uuid = base62.encode(crypto.randomBytes(8));
    conn.uuid = uuid;
    senders.set(uuid, conn);
    send(conn, { type: 'hello', uuid });
    log.info('sender registered');
  }

  ws.on('error', (err) => {
    log.error('ws error: %s', err.message);
  });

  ws.on('message', (data, isBinary) => {
    resetTimeout(conn);
    if (conn.peer) {
      resetTimeout(conn.peer);
      conn.peer.ws.send(data, { binary: isBinary });
    } else {
      log.error('data sent without established pipe');
      ws.close();
    }
  });

  ws.on('close', () => {
    log.info('ws closed');
    cleanup(conn);
  });
}
