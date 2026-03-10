import {
  generateKeyPair,
  exportPublicKey,
  importPublicKey,
  encryptPayload,
  decryptPayload,
  generateMagicNumbers,
  type EncryptedPayload,
} from './crypto.js';

interface WsHelloMessage { type: 'hello'; uuid: string }
interface WsPubkeyMessage { type: 'pubkey'; key: JsonWebKey; magicNumbers: number[] }
interface WsEncmsgMessage { type: 'encmsg'; key: string; msg: string; iv: string }
interface WsDisconnectMessage { type: 'sdisconnect' | 'rdisconnect' }
type WsMessage = WsHelloMessage | WsPubkeyMessage | WsEncmsgMessage | WsDisconnectMessage;

const MESSAGE_HANDLERS: Record<string, (ctx: AppContext, msg: WsMessage) => void | Promise<void>> = {
  hello(ctx, msg) {
    if (msg.type !== 'hello') return;
    ctx.link = location.href + '#' + msg.uuid;
  },

  async pubkey(ctx, msg) {
    if (msg.type !== 'pubkey') return;
    ctx.publicKey = await importPublicKey(msg.key);
    ctx.isConnected = true;
    ctx.magicNumbers = msg.magicNumbers;
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

  // Internal
  ws: WebSocket;
  publicKey: CryptoKey | null;
  keyPair: CryptoKeyPair | null;

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
    ws: null!,
    publicKey: null,
    keyPair: null,
    $refs: null!,
  };

  return {
    ...ctx,

    init(this: AppContext) {
      const baseUrl = location.protocol.replace('http', 'ws') + '//' + location.host + '/ws';
      const senderId = location.hash.length > 2 ? location.hash.substring(1) : null;
      const url = senderId ? `${baseUrl}?sender=${senderId}` : baseUrl;

      this.role = senderId ? 'receiver' : 'sender';

      this.ws = new WebSocket(url);
      this.ws.addEventListener('open', () => {
        if (this.role === 'receiver') setupReceiver(this);
      });
      this.ws.addEventListener('message', (e: MessageEvent) => onMessage(this, e));
      this.ws.addEventListener('close', () => {
        if (!this.hasFinished && !this.error) {
          this.error = 'It looks like there was an issue with the connection to the server. Please refresh and try again.';
        }
      });
      this.ws.addEventListener('error', () => {
        if (this.role === 'receiver') {
          this.error = 'There was an issue connecting to the sender. Please ensure the link is valid and has only been used once.';
        } else {
          this.error = 'There was an issue connecting to the server. Please refresh the page and try again.';
        }
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
        const payload = await encryptPayload(this.publicKey!, this.messageInput!);
        this.ws.send(JSON.stringify({ type: 'encmsg', ...payload }));
        this.hasFinished = true;
        this.ws.close();
      } catch (err) {
        console.error('Encryption failed:', err);
        this.error = 'Failed to encrypt the message. Please refresh and try again.';
      }
    },

    showAbout() {
      alert(
        `Hi there! Thanks for checking out securetext.io.\n\n` +
          `This quick & simple web app establishes a connection between a sender and a receiver ` +
          `through a middleman server, hosted for your convenience by Zyno Consulting.\n\n` +
          `When a receiver connects to the sender (via the middleman), it generates an asymmetric ` +
          `key pair for RSA encryption. It then forwards the public key to the sender.\n\n` +
          `When the sender clicks the Send button, a 128-bit AES-GCM key is generated by the sender. ` +
          `That key is used to encrypt the message. The AES key is then encrypted using the receiver's public RSA key.\n\n` +
          `Both the encrypted message and the RSA-encrypted AES key are then transmitted to the receiver, ` +
          `at which point the receiver uses its RSA private key to decrypt the AES key, and then in turn, decrypt the message.\n\n` +
          `This provides a convenient end-to-end encrypted method of sending simple text data between a sender and receiver.\n\n` +
          `As an added layer of security, 3 unique numbers are generated by the receiver so that the sender can verify that they are ` +
          `in fact sending to the expected recipient.`,
      );
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
  ctx.magicNumbers = generateMagicNumbers();
  ctx.keyPair = await generateKeyPair();
  const publicKey = await exportPublicKey(ctx.keyPair);
  ctx.ws.send(JSON.stringify({ type: 'pubkey', key: publicKey, magicNumbers: ctx.magicNumbers }));
  ctx.isConnected = true;
}
