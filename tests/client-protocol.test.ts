import { expect, it } from 'vitest';
import {
  decryptPayload,
  encryptPayload,
  exportPublicKey,
  generateKeyPair,
  importPublicKey,
} from '../src/client/crypto.js';
import {
  buildShareLink,
  createShareSecret,
  deriveMagicNumbers,
  parseShareHash,
  signEncryptedPayload,
  signPubkeyMessage,
  verifyEncryptedPayload,
  verifyPubkeyMessage,
} from '../src/client/protocol.js';

function tamper(value: string): string {
  const lastChar = value.at(-1) === 'A' ? 'B' : 'A';
  return `${value.slice(0, -1)}${lastChar}`;
}

it('round-trips the share link secret through the URL fragment', () => {
  const sharedSecret = createShareSecret();
  const link = buildShareLink('https://securetext.example/', 'sender123', sharedSecret);
  const parsed = parseShareHash(new URL(link).hash);

  expect(parsed).toEqual({
    senderId: 'sender123',
    sharedSecret,
    isLegacy: false,
  });
});

it('treats legacy links without a fragment secret as unsupported', () => {
  expect(parseShareHash('#legacySender')).toEqual({
    senderId: null,
    sharedSecret: null,
    isLegacy: true,
  });
});

it('authenticates the receiver public key before the sender accepts it', async () => {
  const sharedSecret = createShareSecret();
  const keyPair = await generateKeyPair();
  const publicKey = await exportPublicKey(keyPair);
  const mac = await signPubkeyMessage(sharedSecret, publicKey);

  expect(await verifyPubkeyMessage(sharedSecret, publicKey, mac)).toBe(true);
  expect(await verifyPubkeyMessage(sharedSecret, tamper(publicKey), mac)).toBe(false);
  expect(await deriveMagicNumbers(publicKey)).toHaveLength(3);
});

it('authenticates encrypted payloads before decrypting them', async () => {
  const sharedSecret = createShareSecret();
  const receiverKeyPair = await generateKeyPair();
  const receiverPublicKey = await importPublicKey(await exportPublicKey(receiverKeyPair));
  const payload = await encryptPayload(receiverPublicKey, 'top secret');
  const mac = await signEncryptedPayload(sharedSecret, payload);

  expect(await verifyEncryptedPayload(sharedSecret, payload, mac)).toBe(true);
  expect(await verifyEncryptedPayload(sharedSecret, { ...payload, msg: tamper(payload.msg) }, mac)).toBe(false);
  expect(await decryptPayload(receiverKeyPair, payload)).toBe('top secret');
});
