import {
  generateKeyPair,
  exportPublicKey,
  importPublicKey,
  encryptPayload,
  decryptPayload,
  type EncryptedPayload,
} from './crypto.js';
import {
  buildShareLink,
  createShareSecret,
  deriveMagicNumbers,
  parseShareHash,
  signEncryptedPayload,
  signPubkeyMessage,
  verifyEncryptedPayload,
  verifyPubkeyMessage,
} from './protocol.js';

interface WsHelloMessage { type: 'hello'; uuid: string }
interface WsPubkeyMessage { type: 'pubkey'; key: string; mac: string }
interface WsEncmsgMessage { type: 'encmsg'; key: string; msg: string; iv: string; mac: string }
interface WsDisconnectMessage { type: 'sdisconnect' | 'rdisconnect' }
type WsMessage = WsHelloMessage | WsPubkeyMessage | WsEncmsgMessage | WsDisconnectMessage;

const MESSAGE_HANDLERS: Record<string, (ctx: AppContext, msg: WsMessage) => void | Promise<void>> = {
  hello(ctx, msg) {
    if (msg.type !== 'hello') return;
    ctx.link = buildShareLink(location.href, msg.uuid, ctx.sharedSecret!);
  },

  async pubkey(ctx, msg) {
    if (msg.type !== 'pubkey') return;
    const isValid = await verifyPubkeyMessage(ctx.sharedSecret!, msg.key, msg.mac);
    if (!isValid) {
      ctx.error = 'Failed to verify the recipient connection. Please ask the recipient for a new link.';
      ctx.ws.close();
      return;
    }

    ctx.publicKey = await importPublicKey(msg.key);
    ctx.isConnected = true;
    ctx.magicNumbers = await deriveMagicNumbers(msg.key);
  },

  sdisconnect(ctx) {
    if (!ctx.hasFinished) {
      ctx.error = 'The sender appears to have disconnected. Please ask the sender for a new link.';
    }
  },

  rdisconnect(ctx) {
    ctx.isConnected = false;
  },

  async encmsg(ctx, msg) {
    if (msg.type !== 'encmsg') return;
    try {
      const payload: EncryptedPayload = { key: msg.key, msg: msg.msg, iv: msg.iv };
      const isValid = await verifyEncryptedPayload(ctx.sharedSecret!, payload, msg.mac);
      if (!isValid) {
        ctx.error = 'Failed to verify the message. The data may have been tampered with.';
        ctx.ws.close();
        return;
      }

      ctx.message = await decryptPayload(ctx.keyPair!, payload);
      ctx.hasFinished = true;
      ctx.ws.close();
    } catch (err) {
      console.error('Decryption failed:', err);
      ctx.error = 'Failed to decrypt the message. The data may have been corrupted.';
    }
  },
};

interface AppContext {
  // Reactive state
  error: string | null;
  role: 'sender' | 'receiver' | null;
  isConnected: boolean;
  link: string | null;
  magicNumbers: number[] | null;
  messageInput: string | null;
  message: string | null;
  hasFinished: boolean;
  showingAbout: boolean;

  // Internal
  ws: WebSocket;
  publicKey: CryptoKey | null;
  keyPair: CryptoKeyPair | null;
  sharedSecret: string | null;

  // Alpine magics
  $refs: Record<string, HTMLElement>;
}

export function app(): Record<string, unknown> {
  const ctx: AppContext = {
    error: null,
    role: null,
    isConnected: false,
    link: null,
    magicNumbers: null,
    messageInput: null,
    message: null,
    hasFinished: false,
    showingAbout: false,
    ws: null!,
    publicKey: null,
    keyPair: null,
    sharedSecret: null,
    $refs: null!,
  };

  return {
    ...ctx,

    init(this: AppContext) {
      const baseUrl = location.protocol.replace('http', 'ws') + '//' + location.host + '/ws';
      const { senderId, sharedSecret, isLegacy } = parseShareHash(location.hash);
      if (isLegacy) {
        this.error = 'This link is invalid or has expired. Please ask the sender for a new link.';
        return;
      }

      this.sharedSecret = sharedSecret ?? createShareSecret();
      const url = senderId ? `${baseUrl}?sender=${encodeURIComponent(senderId)}` : baseUrl;

      this.role = senderId ? 'receiver' : 'sender';

      this.ws = new WebSocket(url);
      this.ws.addEventListener('open', () => {
        if (this.role === 'receiver') setupReceiver(this);
      });
      this.ws.addEventListener('message', (e: MessageEvent) => onMessage(this, e));
      this.ws.addEventListener('close', (e: CloseEvent) => {
        if (this.hasFinished || this.error) return;
        if (e.code === 4404) {
          this.error = 'This link is invalid or has expired.';
        } else if (e.code === 4409) {
          this.error = 'A receiver has already connected to this link.';
        } else if (e.code === 4429) {
          this.error = 'Too many connections. Please try again later.';
        } else {
          this.error = 'It looks like there was an issue with the connection to the server. Please refresh and try again.';
        }
      });
      this.ws.addEventListener('error', () => {
        this.error = 'There was an issue connecting to the server. Please refresh the page and try again.';
      });

      window.addEventListener('hashchange', () => location.reload());
      setTimeout(() => this.$refs.message?.focus(), 100);
    },

    shareLink(this: AppContext) {
      if (navigator.share && navigator.userAgent.includes('Mobile')) {
        navigator.share({ title: 'securetext.io', url: this.link! });
      } else {
        const container = document.getElementById('link-container')!;
        container.classList.add('animate');
        setTimeout(() => container.classList.remove('animate'), 1000);
        navigator.clipboard.writeText(this.link!);
        this.$refs.message?.focus();
      }
    },

    async sendMessage(this: AppContext, e: Event) {
      e.preventDefault();
      try {
        if (!this.publicKey || !this.sharedSecret || this.messageInput === null) {
          this.error = 'The secure channel is not ready yet. Please refresh and try again.';
          return;
        }

        const payload = await encryptPayload(this.publicKey!, this.messageInput!);
        const mac = await signEncryptedPayload(this.sharedSecret, payload);
        this.ws.send(JSON.stringify({ type: 'encmsg', ...payload, mac }));
        this.hasFinished = true;
        this.ws.close();
      } catch (err) {
        console.error('Encryption failed:', err);
        this.error = 'Failed to encrypt the message. Please refresh and try again.';
      }
    },

  };
}

function onMessage(ctx: AppContext, e: MessageEvent) {
  let msg: WsMessage;
  try {
    msg = JSON.parse(e.data);
  } catch {
    console.error('Failed to parse message');
    return;
  }

  if (!msg.type || typeof msg.type !== 'string') {
    console.error('Message missing type field');
    return;
  }

  const handler = MESSAGE_HANDLERS[msg.type];
  if (handler) {
    Promise.resolve(handler(ctx, msg)).catch((err) => {
      console.error('Error handling message:', err);
      ctx.error = 'An error occurred while processing data. Please refresh and try again.';
    });
  } else {
    console.error('Unexpected message type:', msg.type);
  }
}

async function setupReceiver(ctx: AppContext) {
  if (!ctx.sharedSecret) {
    ctx.error = 'This link is invalid or has expired. Please ask the sender for a new link.';
    ctx.ws.close();
    return;
  }

  ctx.keyPair = await generateKeyPair();
  const publicKey = await exportPublicKey(ctx.keyPair);
  ctx.magicNumbers = await deriveMagicNumbers(publicKey);
  const mac = await signPubkeyMessage(ctx.sharedSecret, publicKey);
  ctx.ws.send(JSON.stringify({ type: 'pubkey', key: publicKey, mac }));
  ctx.isConnected = true;
}
